-- =============================================================================
-- Catálogos genéricos de Reportes de Trabajo (precarga de "Información general")
-- Una sola tabla `wr_catalogs` con columna `kind` para no crear una tabla por
-- cada campo. Tipos iniciales: client | contract | location | shift | workschedule.
-- Extensible: agregar un nuevo catálogo = un nuevo `kind`, sin migración.
-- Las áreas/especialidades/hitos siguen en sus tablas propias (wr_areas/…).
-- RLS canónico (bypass super-admin + aislamiento por tenant) + GRANT. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wr_catalogs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  kind       text NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wr_catalogs_tenant_kind ON public.wr_catalogs(tenant_id, kind);

ALTER TABLE public.wr_catalogs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wr_catalogs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.wr_catalogs', pol.policyname);
  END LOOP;

  EXECUTE $policy$
    CREATE POLICY wr_catalogs_tenant ON public.wr_catalogs
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $policy$;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wr_catalogs TO authenticated;
