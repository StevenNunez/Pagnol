-- =============================================================================
-- S3 — RLS consolidada (fuente de verdad única)
--
-- Reemplaza los scripts sueltos de /scripts/*.sql (fix_rls_policies,
-- fix_super_admin_rls, fix_profiles_recursion, fix_final_tables,
-- create_enrollment_sessions, add_protocols_tables, attendance-contracts, etc.)
-- por una sola migración versionada con un patrón CONSISTENTE.
--
-- Cambios respecto a los scripts previos:
--   * Todas las tablas multi-tenant usan el MISMO patrón con bypass de
--     super-admin y WITH CHECK explícito (antes había 3 patrones distintos:
--     get_my_tenant_id(), subconsulta inline, y un UNION sin sentido).
--   * Para cada tabla tenant se eliminan TODAS las policies previas (drop
--     dinámico) antes de crear la canónica → sin drift ni policies permisivas
--     huérfanas. Es seguro: FOR ALL cubre todo el CRUD del propio tenant.
--   * Se elimina el bloque con UUID/email personales hardcodeados.
--   * Se normaliza el rol 'admin' → 'administrador' (rol inexistente en la app).
--
-- NO toca: qr_tokens ni storage.* (tienen sus propias migraciones).
-- Depende de / complementa: 20260612000000_security_rls_hardening.sql (trigger
-- anti-escalada en profiles + drop de invitations_read_by_token).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super-admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── Normalización de datos: rol legacy 'admin' → 'administrador' ──────────────
UPDATE public.profiles SET role = 'administrador' WHERE role = 'admin';

-- ── Tablas multi-tenant: patrón canónico único ───────────────────────────────
-- Para cada tabla existente: habilita RLS, elimina TODAS sus policies y crea
-- una sola FOR ALL con bypass de super-admin + aislamiento por tenant.
DO $$
DECLARE
  t    text;
  pol  record;
  tenant_tables text[] := ARRAY[
    'materials','material_categories','units','suppliers','purchase_requests',
    'material_requests','tools','tool_logs','stock_movements','return_requests',
    'purchase_lots','purchase_orders','supplier_payments','salary_advances',
    'attendance_logs','checklist_templates','assigned_checklists','safety_inspections',
    'behavior_observations','daily_talks','work_items','progress_logs','payment_states',
    'counters','subscriptions','maintenance_orders','maintenance_logs','ea_documents',
    'protocol_templates','protocols','shift_schedules','contracts','contract_workers',
    'enrollment_sessions','invitations'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

      -- Eliminar cualquier policy previa (nombres heterogéneos según el script origen)
      FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = t
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
      END LOOP;

      -- Policy canónica
      EXECUTE format($f$
        CREATE POLICY %I ON public.%I
        FOR ALL
        USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
        WITH CHECK (public.is_super_admin() OR tenant_id = public.get_my_tenant_id())
      $f$, t || '_tenant', t);
    END IF;
  END LOOP;
END $$;

-- ── profiles ─────────────────────────────────────────────────────────────────
-- Recursión evitada con get_my_tenant_id() (SECURITY DEFINER). La protección
-- contra auto-escalada de role/tenant_id/granted_permissions la aplica el
-- trigger trg_prevent_profile_escalation (migración 20260612000000).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='profiles' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_select_tenant" ON public.profiles
  FOR SELECT USING (public.is_super_admin() OR tenant_id = public.get_my_tenant_id());

CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id OR public.is_super_admin());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id OR public.is_super_admin());

CREATE POLICY "profiles_delete_super_admin" ON public.profiles
  FOR DELETE USING (public.is_super_admin());

-- ── tenants ──────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='tenants' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tenants', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "tenants_select_own" ON public.tenants
  FOR SELECT USING (public.is_super_admin() OR id = public.get_my_tenant_id());

-- Necesario para el flujo de registro (el usuario recién autenticado crea su tenant).
CREATE POLICY "tenants_insert_authenticated" ON public.tenants
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "tenants_update_own" ON public.tenants
  FOR UPDATE USING (public.is_super_admin() OR id = public.get_my_tenant_id());

-- ── Tablas globales de solo-lectura ──────────────────────────────────────────
-- roles y subscription_plans no tienen tenant_id; lectura pública para que la
-- app resuelva permisos/planes. (Nota: el hardening de la tabla global `roles`
-- —S-6— se aborda por separado; aquí se preserva el comportamiento existente.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='roles') THEN
    EXECUTE 'ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "roles_public" ON public.roles';
    EXECUTE 'CREATE POLICY "roles_public" ON public.roles FOR SELECT USING (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='subscription_plans') THEN
    EXECUTE 'ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "subscription_plans_public" ON public.subscription_plans';
    EXECUTE 'CREATE POLICY "subscription_plans_public" ON public.subscription_plans FOR SELECT USING (true)';
  END IF;
END $$;

-- ── push_subscriptions ───────────────────────────────────────────────────────
-- Cada usuario gestiona sus propias suscripciones; el envío usa service role.
DO $$
DECLARE pol record;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='push_subscriptions') THEN
    EXECUTE 'ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY';
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='push_subscriptions' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.push_subscriptions', pol.policyname);
    END LOOP;
    EXECUTE 'CREATE POLICY "push_subscriptions_own" ON public.push_subscriptions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;
