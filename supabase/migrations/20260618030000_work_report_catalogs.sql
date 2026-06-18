-- =============================================================================
-- Reportes de Trabajo - Catalogos de precarga (arquitectura en cascada)
-- Tablas simples tenant-scoped para precargar los formularios de OT:
--   wr_areas        (Carbonato, Hidroxido, Linea 3, ...)
--   wr_specialties  (Electricidad, Soldadura Mecanica, FRP, HDPE, Andamios, OCC)
--   wr_milestones   (hitos del contrato)
-- RLS con el patron canonico (bypass super-admin + aislamiento por tenant) +
-- GRANT explicito a `authenticated` (requerido en proyectos Supabase post may-2026).
-- Requiere public.is_super_admin() y public.get_my_tenant_id(). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wr_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wr_specialties (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wr_milestones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wr_areas_tenant       ON public.wr_areas(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wr_specialties_tenant ON public.wr_specialties(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wr_milestones_tenant  ON public.wr_milestones(tenant_id);

-- ── RLS: patron canonico por tenant ──────────────────────────────────────────
DO $$
DECLARE
  t   text;
  pol record;
  catalog_tables text[] := ARRAY['wr_areas', 'wr_specialties', 'wr_milestones'];
BEGIN
  FOREACH t IN ARRAY catalog_tables LOOP
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

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.wr_areas, public.wr_specialties, public.wr_milestones
  TO authenticated;
