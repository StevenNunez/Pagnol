-- RFC-006 F0 + F1 — Configuración de firmas por monto y revisión del Jefe de Operaciones.
--
-- F0: dónde viven los montos y quién es el ADC de cada contrato.
-- F1: compras y arriendos que pide terreno pasan primero por el Jefe de
--     Operaciones (corrige, aprueba o rechaza) y recién después al ADC.
--
-- Todo es ADITIVO: columnas nuevas, ningún estado existente cambia de
-- significado. El gate del ADC (`adc_authorized_at`) sigue siendo la puerta de
-- Abastecimiento; lo que se agrega es un paso ANTES.

-- ── F0 ────────────────────────────────────────────────────────────────────────

-- Montos de firma por empresa. NULL = valores de fábrica (los de Valar:
-- hasta $500.000 con IVA firma el ADC; sobre eso, el Gerente General).
-- Forma: { "adcMaxGross": 500000, "vatRate": 0.19 }.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS approval_settings jsonb;

COMMENT ON COLUMN public.tenants.approval_settings IS
  'RFC-006: { adcMaxGross, vatRate }. Total con IVA hasta adcMaxGross lo firma el ADC del contrato; '
  'sobre eso, sólo el Gerente General. NULL = valores de fábrica. Lo edita quien administra la empresa '
  '(lo cubre trg_prevent_tenant_platform_escalation).';

-- El ADC de cada contrato: firma lo que cae en su tramo para ESE contrato.
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS adc_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contracts.adc_user_id IS
  'RFC-006: Administrador de Contrato que firma las propuestas de este contrato. '
  'Sin ADC asignado la propuesta se bloquea con aviso; nunca cae a "cualquier ADC".';

-- ── F1 ────────────────────────────────────────────────────────────────────────

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS ops_reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ops_reviewed_by      uuid,
  ADD COLUMN IF NOT EXISTS ops_reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS ops_review_note      text;

ALTER TABLE public.rental_requests
  ADD COLUMN IF NOT EXISTS ops_reviewed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS ops_reviewed_by      uuid,
  ADD COLUMN IF NOT EXISTS ops_reviewed_by_name text,
  ADD COLUMN IF NOT EXISTS ops_review_note      text;

COMMENT ON COLUMN public.purchase_requests.ops_reviewed_at IS
  'RFC-006 F1: revisión del Jefe de Operaciones. NULL en un requerimiento a proveedor pendiente = '
  'en su bandeja. El suministro del cliente y el RQ derivado de un arriendo no pasan por aquí.';
COMMENT ON COLUMN public.rental_requests.ops_reviewed_at IS
  'RFC-006 F1: revisión del Jefe de Operaciones. NULL en una solicitud pendiente = en su bandeja.';

-- Respaldo: lo que ya pasó la etapa del ADC (o ya no está pendiente) no vuelve
-- atrás a pedirle revisión al Jefe de Operaciones. Sólo lo que hoy espera al ADC
-- queda pendiente de revisión y aparece en su bandeja.
UPDATE public.purchase_requests
   SET ops_reviewed_at = COALESCE(adc_authorized_at, created_at),
       ops_review_note = 'Anterior a la revisión del Jefe de Operaciones'
 WHERE ops_reviewed_at IS NULL
   AND (adc_authorized_at IS NOT NULL OR status <> 'pending');

UPDATE public.rental_requests
   SET ops_reviewed_at = COALESCE(adc_authorized_at, created_at),
       ops_review_note = 'Anterior a la revisión del Jefe de Operaciones'
 WHERE ops_reviewed_at IS NULL
   AND (adc_authorized_at IS NOT NULL OR status <> 'pending');

-- ── Campana: contadores ───────────────────────────────────────────────────────
-- Cambia la forma de la tabla que devuelve (dos columnas nuevas), y eso no se
-- puede con CREATE OR REPLACE: hay que borrarla y crearla de nuevo.
DROP FUNCTION IF EXISTS public.dashboard_badges(uuid);

CREATE FUNCTION public.dashboard_badges(p_tenant_id uuid)
RETURNS TABLE (
  pending_auth_material      integer,
  pending_auth_purchase      integer,
  pending_auth_rental        integer,
  pending_material_requests  integer,
  pending_purchase_requests  integer,
  overdue_payments           integer,
  due_soon_payments          integer,
  pending_cotizaciones       integer,
  pending_receptions         integer,
  over_budget_cost_centers   integer,
  pending_ops_purchase       integer,
  pending_ops_rental         integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
  hoy AS (
    SELECT (now() AT TIME ZONE 'America/Santiago')::date AS d
  ),
  recibido AS (
    SELECT gr.purchase_order_id AS po_id,
           it->>'itemId'        AS item_key,
           SUM(COALESCE(NULLIF(it->>'receivedQuantity','')::numeric, 0)) AS qty
    FROM public.goods_receipts gr,
         LATERAL jsonb_array_elements(COALESCE(gr.items, '[]'::jsonb)) AS it
    WHERE gr.tenant_id = p_tenant_id
    GROUP BY 1, 2
  ),
  oc_abierta AS (
    SELECT po.id AS po_id,
           COALESCE(t.it->>'id', (t.it->>'name') || '#' || (t.ord - 1)) AS item_key,
           COALESCE(NULLIF(t.it->>'totalQuantity','')::numeric, 0)      AS total_qty
    FROM public.purchase_orders po,
         LATERAL jsonb_array_elements(COALESCE(po.items, '[]'::jsonb))
                 WITH ORDINALITY AS t(it, ord)
    WHERE po.tenant_id = p_tenant_id
      AND po.status IN ('generated', 'sent', 'issued')
  )
  SELECT
    -- Bandeja del ADC: pendientes SIN autorizar y que ya pasaron (o no necesitan)
    -- la revisión del Jefe de Operaciones.
    (SELECT COUNT(*) FROM public.material_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL)::integer,
    (SELECT COUNT(*) FROM public.purchase_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL
        AND (ops_reviewed_at IS NOT NULL
             OR COALESCE(request_target, 'supplier') = 'client'
             OR rental_request_id IS NOT NULL))::integer,
    (SELECT COUNT(*) FROM public.rental_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NULL
        AND ops_reviewed_at IS NOT NULL)::integer,

    (SELECT COUNT(*) FROM public.material_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NOT NULL)::integer,
    (SELECT COUNT(*) FROM public.purchase_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND adc_authorized_at IS NOT NULL)::integer,

    (SELECT COUNT(*) FROM public.supplier_payments, hoy
      WHERE tenant_id = p_tenant_id
        AND COALESCE(status, '') <> 'paid'
        AND due_date::date < hoy.d)::integer,
    (SELECT COUNT(*) FROM public.supplier_payments, hoy
      WHERE tenant_id = p_tenant_id
        AND COALESCE(status, '') <> 'paid'
        AND due_date::date >= hoy.d
        AND due_date::date <= hoy.d + 7)::integer,

    (SELECT COUNT(*) FROM public.purchase_orders
      WHERE tenant_id = p_tenant_id AND status = 'generated')::integer,

    (SELECT COUNT(DISTINCT o.po_id)
       FROM oc_abierta o
       LEFT JOIN recibido r ON r.po_id = o.po_id AND r.item_key = o.item_key
      WHERE COALESCE(r.qty, 0) < o.total_qty)::integer,

    (SELECT COUNT(*) FROM public.cost_centers cc
      WHERE cc.tenant_id = p_tenant_id
        AND COALESCE(cc.budget, 0) > 0
        AND (SELECT COALESCE(SUM(po.total_amount), 0)
               FROM public.purchase_orders po
              WHERE po.tenant_id = p_tenant_id
                AND po.cost_center_id = cc.id
                AND COALESCE(po.status, '') <> 'cancelled') > cc.budget)::integer,

    -- Bandeja del Jefe de Operaciones (RFC-006 F1).
    (SELECT COUNT(*) FROM public.purchase_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND ops_reviewed_at IS NULL AND adc_authorized_at IS NULL
        AND COALESCE(request_target, 'supplier') <> 'client'
        AND rental_request_id IS NULL)::integer,
    (SELECT COUNT(*) FROM public.rental_requests
      WHERE tenant_id = p_tenant_id AND status = 'pending'
        AND ops_reviewed_at IS NULL AND adc_authorized_at IS NULL)::integer
$$;

REVOKE ALL ON FUNCTION public.dashboard_badges(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_badges(uuid) TO authenticated;

COMMENT ON FUNCTION public.dashboard_badges(uuid) IS
  'RFC-005 F1 + RFC-006 F1: contadores de los badges de la barra superior en un solo viaje. '
  'SECURITY INVOKER — el aislamiento entre tenants lo sigue garantizando la RLS.';
