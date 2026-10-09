-- ════════════════════════════════════════════════════════════════════════════
-- Retiro con revisión posterior (etapa 1)
--
-- Pedido del supervisor de Valar (2026-10-07): cada trabajador retira 10-15 cosas
-- por día y la clase B frenaba TODO el retiro en ventanilla hasta que el
-- supervisor aprobaba. Con esta modalidad, por empresa:
--   'prior' → como hasta hoy: A y B piden aprobación ANTES de salir.
--   'post'  → C y B se entregan en el acto y el supervisor las revisa DESPUÉS,
--             línea por línea. La clase A sigue pidiendo aprobación previa.
--
-- La revisión es un hecho append-only (Artículo 2 del manifiesto): no se edita
-- ni se borra. Lo que se marca "no autorizado" se resuelve en la etapa 3 con
-- hechos nuevos (devolución o justificación), nunca reescribiendo la revisión.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Modo por empresa ─────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS withdrawal_review_mode text NOT NULL DEFAULT 'prior';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_withdrawal_review_mode_check'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_withdrawal_review_mode_check
      CHECK (withdrawal_review_mode IN ('prior', 'post'));
  END IF;
END $$;

-- ── Marca en la entrega ──────────────────────────────────────────────────────
-- Se fija al entregar y no cambia: dice CÓMO salió el retiro, no en qué va su
-- revisión (eso se deriva de withdrawal_reviews).
ALTER TABLE public.material_requests
  ADD COLUMN IF NOT EXISTS requires_review boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_material_requests_requires_review
  ON public.material_requests (tenant_id, created_at DESC)
  WHERE requires_review;

-- ── Revisiones (hechos) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.withdrawal_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES public.material_requests(id) ON DELETE CASCADE,
  -- Snapshot del material: si se renombra o archiva, la revisión conserva lo del día.
  material_id   uuid REFERENCES public.materials(id) ON DELETE SET NULL,
  material_name text NOT NULL,
  quantity      numeric NOT NULL CHECK (quantity > 0),
  decision      text NOT NULL CHECK (decision IN ('authorized', 'unauthorized')),
  reason        text,
  reviewer_id   uuid NOT NULL REFERENCES public.profiles(id),
  reviewer_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- "No corresponde" sin motivo no le sirve a quien tiene que resolverlo.
  CONSTRAINT withdrawal_reviews_reason_required
    CHECK (decision = 'authorized' OR (reason IS NOT NULL AND length(btrim(reason)) > 0)),
  -- Una decisión por línea: la revisión no se rehace, se resuelve aparte.
  CONSTRAINT withdrawal_reviews_one_per_line UNIQUE (request_id, material_id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_reviews_tenant
  ON public.withdrawal_reviews (tenant_id, created_at DESC);

ALTER TABLE public.withdrawal_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawal_reviews_select" ON public.withdrawal_reviews;
CREATE POLICY "withdrawal_reviews_select" ON public.withdrawal_reviews
  FOR SELECT USING (
    public.is_super_admin() OR tenant_id = public.get_my_tenant_id()
  );

-- Sólo se inserta: en el propio tenant, firmado por quien revisa, y sólo sobre
-- un retiro que salió con revisión posterior.
DROP POLICY IF EXISTS "withdrawal_reviews_insert" ON public.withdrawal_reviews;
CREATE POLICY "withdrawal_reviews_insert" ON public.withdrawal_reviews
  FOR INSERT WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.material_requests mr
      WHERE mr.id = request_id
        AND mr.tenant_id = withdrawal_reviews.tenant_id
        AND mr.requires_review
    )
  );

GRANT SELECT, INSERT ON public.withdrawal_reviews TO authenticated;
REVOKE UPDATE, DELETE ON public.withdrawal_reviews FROM authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'withdrawal_reviews'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_reviews;
  END IF;
END $$;
