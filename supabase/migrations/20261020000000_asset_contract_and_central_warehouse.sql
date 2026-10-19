-- =============================================================================
-- Activos: contrato visible mientras están entregados + pañol central
--
-- 1. Un activo llega a un contrato SOLO por una solicitud de material. La
--    entrega descuenta el stock del activo, así que el desglose por contrato
--    queda en cero y la API no tenía de dónde sacar el contrato. Ahora
--    `api_asset_holders` devuelve también el contrato de la entrega vigente.
-- 2. `warehouses.is_central`: el pañol al que vuelven los activos al
--    devolverse (la oficina central es el centro de los activos). A lo más uno
--    por empresa.
-- =============================================================================

-- ── 2. Pañol central ────────────────────────────────────────────────────────
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS is_central boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_central ON public.warehouses (tenant_id) WHERE is_central;

-- ── 1. Quién tiene cada activo, y para qué contrato ─────────────────────────
-- Misma regla que computeToolHolderMap (src/modules/core/lib/tool-loans.ts):
-- la última entrega aprobada lo deja en poder de quien lo recibió, y una
-- devolución completada lo libera. Si cambia una, cambiar la otra.
-- Cambia el tipo de retorno (columnas nuevas al final): hay que recrearla.
DROP FUNCTION IF EXISTS public.api_asset_holders(uuid, uuid[]);
CREATE FUNCTION public.api_asset_holders(p_tenant_id uuid, p_ids uuid[])
RETURNS TABLE (material_id uuid, holder_id text, holder_name text, since timestamptz, contract_id uuid, contract_name text)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  WITH ev AS (
    SELECT (it->>'materialId')::uuid AS mid,
           COALESCE(mr.approval_date, mr.created_at) AS t,
           'out' AS kind,
           COALESCE(mr.received_by_user_id::text,
                    CASE WHEN mr.delivery_mode = 'directed' THEN mr.beneficiary_id::text END,
                    mr.supervisor_id::text) AS hid,
           COALESCE(mr.received_by_user_name, mr.beneficiary_name, mr.supervisor_name) AS hname,
           mr.contract_id AS cid,
           mr.contract_name AS cname
      FROM public.material_requests mr
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(mr.items, '[]'::jsonb)) it
     WHERE mr.tenant_id = p_tenant_id AND mr.status = 'approved'
       AND (it->>'materialId') = ANY (SELECT unnest(p_ids)::text)
    UNION ALL
    SELECT rr.material_id, COALESCE(rr.completion_date, rr.created_at), 'in', NULL, NULL, NULL::uuid, NULL
      FROM public.return_requests rr
     WHERE rr.tenant_id = p_tenant_id AND rr.status = 'completed'
       AND rr.material_id = ANY (p_ids)
  ),
  last_ev AS (
    SELECT DISTINCT ON (mid) mid, t, kind, hid, hname, cid, cname
      FROM ev ORDER BY mid, t DESC
  )
  SELECT l.mid, l.hid, COALESCE(l.hname, p.name, 'Desconocido'), l.t,
         c.id, COALESCE(c.name, l.cname)
    FROM last_ev l
    LEFT JOIN public.profiles p ON p.id::text = l.hid
    LEFT JOIN public.contracts c ON c.id = l.cid AND c.tenant_id = p_tenant_id
   WHERE l.kind = 'out';
$$;

REVOKE EXECUTE ON FUNCTION public.api_asset_holders(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.api_asset_holders(uuid, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
