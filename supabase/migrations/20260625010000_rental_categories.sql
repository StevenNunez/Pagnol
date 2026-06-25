-- =============================================================================
-- Categorías de Arriendo gestionables por tenant
--
-- Hasta ahora la categoría de un equipo de arriendo era un enum fijo en código
-- (machinery|truck|vehicle|measurement|other). Esta tabla permite que cada tenant
-- cree sus propias categorías (p.ej. "Contenedores", "Andamios", "Generadores")
-- para que las solicitudes/activos/reportes sean más exactos.
--
-- Las categorías por defecto siguen viviendo en código (RENTAL_CATEGORY_DEFAULTS) y
-- se fusionan con las de esta tabla en la UI; aquí solo se guardan las personalizadas.
--
-- RLS canónico por tenant (bypass super-admin) + GRANT explícito a `authenticated`.
-- Requiere helpers public.is_super_admin() y public.get_my_tenant_id(). Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rental_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rental_categories ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_rental_categories_tenant ON public.rental_categories(tenant_id);
-- Evita duplicados por tenant (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rental_categories_tenant_name
  ON public.rental_categories(tenant_id, lower(name));

-- ── RLS: patrón canónico por tenant ───────────────────────────────────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rental_categories'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.rental_categories', pol.policyname);
  END LOOP;

  EXECUTE $f$
    CREATE POLICY rental_categories_tenant ON public.rental_categories
    FOR ALL
    USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
    WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  $f$;
END $$;

-- ── GRANTs (Data API) ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_categories TO authenticated;

-- ── Realtime ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_categories;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
