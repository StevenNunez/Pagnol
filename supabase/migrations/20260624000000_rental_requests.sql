-- =============================================================================
-- Solicitudes de Arriendo + RFQ de Arriendo (paralelo al de compras)
--
-- Conecta el flujo de Abastecimiento con el módulo de Arriendos (rentals):
--   rental_requests        → solicitud que hace terreno ("necesito un camión pluma")
--   rental_quote_requests  → RFQ paralelo: se cotiza a ARRENDADORES (rental_parties
--                            tipo 'lessor'), se compara y se adjudica. Al adjudicar,
--                            la app genera el rental_contract + asset + 1er pago.
--
-- RLS canónico por tenant (bypass super-admin) + GRANT explícito a `authenticated`
-- (requerido en proyectos Supabase creados desde may-2026, ver
-- 20260608000000_grant_api_access.sql). Idempotente: seguro de re-ejecutar.
-- Requiere las funciones helper public.is_super_admin() y public.get_my_tenant_id().
-- =============================================================================

-- ── Tablas ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rental_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL,
  internal_code          text,
  equipment_name         text NOT NULL,
  category               text NOT NULL DEFAULT 'other', -- machinery|measurement|vehicle|truck|other
  quantity               integer NOT NULL DEFAULT 1,
  start_date             date,
  end_date               date,
  billing_cycle_estimate text NOT NULL DEFAULT 'monthly', -- monthly|biweekly|weekly|daily|one_time
  contract_id            uuid REFERENCES public.contracts(id) ON DELETE SET NULL,
  contract_name          text,
  area                   text,
  justification          text,
  supervisor_id          uuid,
  supervisor_name        text,
  status                 text NOT NULL DEFAULT 'pending', -- pending|quoting|approved|rejected|fulfilled
  approver_id            uuid,
  approver_name          text,
  approval_date          timestamptz,
  rejection_date         timestamptz,
  rejection_reason       text,
  rental_contract_id     uuid REFERENCES public.rental_contracts(id) ON DELETE SET NULL,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_quote_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  internal_code      text,
  title              text NOT NULL,
  status             text NOT NULL DEFAULT 'draft', -- draft|sent|closed|awarded|cancelled
  request_ids        jsonb NOT NULL DEFAULT '[]'::jsonb, -- rental_requests incluidas
  items              jsonb NOT NULL DEFAULT '[]'::jsonb, -- equipos a cotizar
  party_ids          jsonb NOT NULL DEFAULT '[]'::jsonb, -- arrendadores invitados (rental_parties)
  responses          jsonb NOT NULL DEFAULT '[]'::jsonb, -- cotizaciones recibidas
  deadline           date,
  notes              text,
  awarded_party_id   uuid,
  awarded_quote_id   text,
  awarded_at         timestamptz,
  rental_contract_id uuid REFERENCES public.rental_contracts(id) ON DELETE SET NULL,
  created_by         uuid,
  created_by_name    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz
);

-- ── Habilitar RLS de forma estática (reconocible por el linter) ───────────────
ALTER TABLE public.rental_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_quote_requests ENABLE ROW LEVEL SECURITY;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rental_requests_tenant     ON public.rental_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_requests_status     ON public.rental_requests(status);
CREATE INDEX IF NOT EXISTS idx_rental_requests_contract   ON public.rental_requests(contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_requests_supervisor ON public.rental_requests(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_rental_quote_requests_tenant ON public.rental_quote_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_quote_requests_status ON public.rental_quote_requests(status);

-- ── RLS: patrón canónico por tenant ───────────────────────────────────────────
DO $$
DECLARE
  t   text;
  pol record;
  rr_tables text[] := ARRAY['rental_requests','rental_quote_requests'];
BEGIN
  FOREACH t IN ARRAY rr_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    FOR pol IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;

    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
      FOR ALL
      USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
      WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    $f$, t || '_tenant', t);
  END LOOP;
END $$;

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.rental_requests, public.rental_quote_requests
  TO authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Añade las tablas a la publicación de Realtime (idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_quote_requests;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
