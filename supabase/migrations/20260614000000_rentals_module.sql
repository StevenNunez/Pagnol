-- =============================================================================
-- Módulo de Arriendos (Rentals)
--
-- 4 tablas multi-tenant: contrapartes (arrendadores/clientes), contratos,
-- activos arrendados y calendario de pagos. RLS con el patrón canónico
-- (bypass super-admin + aislamiento por tenant) idéntico a
-- 20260612000001_consolidated_rls_policies.sql, y GRANT explícito a
-- `authenticated` (requerido en proyectos Supabase creados desde may-2026,
-- ver 20260608000000_grant_api_access.sql).
--
-- Idempotente: seguro de re-ejecutar.
-- Requiere las funciones helper public.is_super_admin() y public.get_my_tenant_id().
-- =============================================================================

-- ── Tablas ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rental_parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            text NOT NULL,
  party_type      text NOT NULL DEFAULT 'lessor', -- 'lessor' | 'client'
  rut             text,
  contact_name    text,
  email           text,
  phone           text,
  address         text,
  bank            text,
  account_type    text,
  account_number  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_contracts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  code          text,
  direction     text NOT NULL DEFAULT 'incoming', -- 'incoming' | 'outgoing'
  party_id      uuid REFERENCES public.rental_parties(id) ON DELETE SET NULL,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'active',    -- active|pending|finished|cancelled
  start_date    date NOT NULL,
  end_date      date,
  billing_cycle text NOT NULL DEFAULT 'monthly',   -- monthly|biweekly|weekly|daily|one_time
  amount        numeric NOT NULL DEFAULT 0,
  currency      text NOT NULL DEFAULT 'CLP',
  payment_day   integer,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  contract_id  uuid NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  name         text NOT NULL,
  category     text NOT NULL DEFAULT 'other', -- machinery|measurement|vehicle|truck|other
  identifier   text,
  quantity     integer NOT NULL DEFAULT 1,
  unit_price   numeric,
  start_date   date,
  end_date     date,
  status       text NOT NULL DEFAULT 'active', -- active|returned
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rental_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  contract_id    uuid NOT NULL REFERENCES public.rental_contracts(id) ON DELETE CASCADE,
  due_date       date NOT NULL,
  amount         numeric NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending', -- pending|paid|overdue
  paid_date      date,
  payment_method text,
  reference      text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Habilitar RLS de forma estática ───────────────────────────────────────────
-- (Se repite dentro del bloque DO de más abajo; aquí, de forma explícita, para
-- que el linter de Supabase lo reconozca. Re-habilitarlo es idempotente.)
ALTER TABLE public.rental_parties   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_assets    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_payments  ENABLE ROW LEVEL SECURITY;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rental_parties_tenant   ON public.rental_parties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_tenant ON public.rental_contracts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_contracts_party  ON public.rental_contracts(party_id);
CREATE INDEX IF NOT EXISTS idx_rental_assets_tenant    ON public.rental_assets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_assets_contract  ON public.rental_assets(contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_tenant  ON public.rental_payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_contract ON public.rental_payments(contract_id);
CREATE INDEX IF NOT EXISTS idx_rental_payments_due     ON public.rental_payments(due_date);

-- ── RLS: patrón canónico por tenant ───────────────────────────────────────────
DO $$
DECLARE
  t   text;
  pol record;
  rental_tables text[] := ARRAY[
    'rental_parties','rental_contracts','rental_assets','rental_payments'
  ];
BEGIN
  FOREACH t IN ARRAY rental_tables LOOP
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
  public.rental_parties, public.rental_contracts,
  public.rental_assets, public.rental_payments
  TO authenticated;
