-- ════════════════════════════════════════════════════════════════════════════
-- Retiro con revisión posterior (etapa 3): cierre de lo "no autorizado".
--
-- Cada línea que el supervisor marcó "no corresponde" queda como observación
-- abierta. Se cierra de dos formas:
--   · DEVUELTA  → el trabajador devolvió ese material en el pañol. NO se guarda
--                 aquí: se deriva de return_requests (cualquier vía de
--                 devolución sirve, sin tocar esas mutaciones).
--   · JUSTIFICADA → un administrador la cierra con una nota (típico: consumible
--                 ya gastado). Es este hecho.
--
-- Append-only como las revisiones: una justificación no se edita ni se borra.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Quién puede cerrar una observación ───────────────────────────────────────
-- Mismo patrón que can_authorize_spend(): rol administrativo, permiso otorgado
-- a la persona o permiso de la fila de rol de su empresa.
CREATE OR REPLACE FUNCTION public.can_resolve_withdrawal_observations()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'material_requests:resolve_observations'
         OR to_jsonb(r.permissions)         ? 'material_requests:resolve_observations'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_resolve_withdrawal_observations() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_resolve_withdrawal_observations() TO authenticated;

-- ── Justificaciones (hechos) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawal_review_resolutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  review_id        uuid NOT NULL REFERENCES public.withdrawal_reviews(id) ON DELETE CASCADE,
  note             text NOT NULL CHECK (length(btrim(note)) > 0),
  resolved_by      uuid NOT NULL REFERENCES public.profiles(id),
  resolved_by_name text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_review_resolutions_one_per_review UNIQUE (review_id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_review_resolutions_tenant
  ON public.withdrawal_review_resolutions (tenant_id, created_at DESC);

ALTER TABLE public.withdrawal_review_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawal_review_resolutions_select" ON public.withdrawal_review_resolutions;
CREATE POLICY "withdrawal_review_resolutions_select" ON public.withdrawal_review_resolutions
  FOR SELECT USING (
    public.is_super_admin() OR tenant_id = public.get_my_tenant_id()
  );

-- Sólo sobre una línea "no autorizada" del propio tenant, firmada por quien
-- la cierra, y sólo si tiene el permiso.
DROP POLICY IF EXISTS "withdrawal_review_resolutions_insert" ON public.withdrawal_review_resolutions;
CREATE POLICY "withdrawal_review_resolutions_insert" ON public.withdrawal_review_resolutions
  FOR INSERT WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND resolved_by = auth.uid()
    AND public.can_resolve_withdrawal_observations()
    AND EXISTS (
      SELECT 1 FROM public.withdrawal_reviews wr
      WHERE wr.id = review_id
        AND wr.tenant_id = withdrawal_review_resolutions.tenant_id
        AND wr.decision = 'unauthorized'
    )
  );

GRANT SELECT, INSERT ON public.withdrawal_review_resolutions TO authenticated;
REVOKE UPDATE, DELETE ON public.withdrawal_review_resolutions FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'withdrawal_review_resolutions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_review_resolutions;
  END IF;
END $$;
