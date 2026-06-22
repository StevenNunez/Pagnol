-- =============================================================================
-- Permisos por rol AHORA por-tenant (antes: tabla global de solo-lectura).
--
-- Problema corregido:
--   * `roles` era global (sin tenant_id) y solo tenía política SELECT pública.
--   * La lectura vía useSupabaseCollection filtra por tenant_id (columna que no
--     existía) → caía a ROLES_DEFAULT. La escritura (upsert) fallaba con
--     "new row violates row-level security policy for table roles" (no había
--     política INSERT/UPDATE).
--
-- Solución: cada empresa (tenant) tiene su propia configuración de permisos.
--   tenant_id + PK compuesta (id, tenant_id) + RLS por tenant (escritura solo
--   para administradores del propio tenant; super-admin sin restricción).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- 1) Columna tenant_id (FK a tenants, cascade al borrar la empresa).
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- 2) Filas globales antiguas (tenant_id NULL) no son usables en el modelo
--    por-tenant. La app usa ROLES_DEFAULT (código) como base, así que borrarlas
--    no pierde configuración efectiva.
DELETE FROM public.roles WHERE tenant_id IS NULL;

-- 3) PK compuesta (rol + tenant): cada empresa tiene su propia fila por rol.
ALTER TABLE public.roles ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.roles DROP CONSTRAINT IF EXISTS roles_pkey;
ALTER TABLE public.roles ADD CONSTRAINT roles_pkey PRIMARY KEY (id, tenant_id);

-- 4) RLS por tenant.
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_public" ON public.roles;
DROP POLICY IF EXISTS "roles_select" ON public.roles;
DROP POLICY IF EXISTS "roles_insert" ON public.roles;
DROP POLICY IF EXISTS "roles_update" ON public.roles;
DROP POLICY IF EXISTS "roles_delete" ON public.roles;

CREATE POLICY "roles_select" ON public.roles
  FOR SELECT
  USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

CREATE POLICY "roles_insert" ON public.roles
  FOR INSERT
  WITH CHECK (
    public.is_tenant_admin()
    AND (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  );

CREATE POLICY "roles_update" ON public.roles
  FOR UPDATE
  USING (
    public.is_tenant_admin()
    AND (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  )
  WITH CHECK (
    public.is_tenant_admin()
    AND (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  );

CREATE POLICY "roles_delete" ON public.roles
  FOR DELETE
  USING (
    public.is_tenant_admin()
    AND (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
  );

-- 5) GRANTs explícitos (proyectos Supabase nuevos no los heredan).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
