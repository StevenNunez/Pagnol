-- ═══════════════════════════════════════════════════════════════════════════
-- Blindaje de la tabla `tenants` — P0 del módulo super-admin
--
-- PROBLEMA (verificado explotándolo contra la base viva, E2E 18/32 antes del fix):
-- la política `tenants_update_own` (migración 20260612000001) dice
--     FOR UPDATE USING (is_super_admin() OR id = get_my_tenant_id())
-- o sea CUALQUIER miembro autenticado del tenant, sin importar su rol. Un usuario
-- con rol `operador` logró por REST, todo con HTTP 200:
--   · cambiarse el PLAN de suscripción
--   · marcar el CONTRATO de responsabilidad como firmado
--   · asignarse HARDWARE (escáner QR + impresora)
--   · DESACTIVAR su propia empresa (is_active=false)
--   · renombrar la empresa y cambiarle el RUT
--   · alterar `labor_cost_factor` (falsea el margen por contrato de toda la faena)
--   · bajar `criticality_settings` (los umbrales que deciden qué compra necesita
--     aprobación de clase A/B/C — se saltan las autorizaciones)
--
-- Los cuatro primeros son datos de PLATAFORMA: los administra la consola de
-- super-admin, y que el propio cliente pueda reescribirlos por debajo deja sin
-- valor probatorio la auditoría de contratos firmados y el control de planes.
--
-- SOLUCIÓN: un trigger BEFORE UPDATE que congela columnas por nivel, siguiendo el
-- patrón que ya existe en el proyecto para `profiles`
-- (prevent_profile_privilege_escalation, migración 20260612000000). Se prefiere el
-- trigger a estrechar la RLS porque una política no puede comparar OLD contra NEW:
-- sólo puede permitir o negar la fila entera, y aquí hay que distinguir QUÉ columna
-- cambia. La política de UPDATE se mantiene intacta, así que ningún flujo pierde
-- acceso a la fila; lo que cambia es qué campos puede mover cada rol.
--
-- NO se crea ningún permiso nuevo en `permissions.ts` a propósito: `can()` resuelve
-- `dynamicRoles[rol] ?? ROLES_DEFAULT[rol]`, así que un permiso recién inventado es
-- invisible para todo tenant con filas propias en la tabla `roles` (misma razón por
-- la que en Wallet se descartó `module_wallet:view`). El criterio se apoya en roles,
-- que sí son estables.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Helper: ¿puede administrar la configuración de SU empresa? ───────────────
-- Reutiliza el conjunto de is_tenant_admin() (super-admin, administrador,
-- director-faena) y le suma `soporte-pagnol`, que por diseño tiene control total
-- de su tenant (ver CLAUDE.md y feedback_admin_soporte_full_control). No se
-- modifica is_tenant_admin() porque gobierna además profile_documents y ampliarla
-- movería permisos fuera del alcance de este cambio.
CREATE OR REPLACE FUNCTION public.can_manage_tenant_settings()
RETURNS boolean AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('super-admin', 'administrador', 'director-faena', 'soporte-pagnol')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER FUNCTION public.can_manage_tenant_settings() SET search_path = public, extensions;
REVOKE ALL ON FUNCTION public.can_manage_tenant_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_tenant_settings() TO authenticated;

COMMENT ON FUNCTION public.can_manage_tenant_settings() IS
  'Veredicto: ¿el usuario actual administra la configuración de su propia empresa? '
  'Devuelve un booleano sobre auth.uid() y nunca una fila sensible, que es la única '
  'forma segura de usar SECURITY DEFINER en este proyecto.';

-- ── Guard de columnas ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prevent_tenant_platform_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- El service role (crons de UF/costo laboral, /api/tenant/geofence, el registro
  -- de nuevas empresas) opera sin sesión: auth.uid() es NULL. No se le restringe,
  -- igual que en el guard de profiles.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- El super-admin gobierna la plataforma entera.
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- ── Nivel 1: columnas de PLATAFORMA — sólo super-admin ────────────────────
  -- Ni el administrador del propio tenant las toca: son la relación comercial
  -- entre Pagnol y su cliente, no configuración de la empresa.
  IF NEW.plan IS DISTINCT FROM OLD.plan THEN
    RAISE EXCEPTION 'El plan de suscripción sólo lo modifica Pagnol (super-admin).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'El estado activo/inactivo de la empresa sólo lo modifica Pagnol (super-admin).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.contract_signed IS DISTINCT FROM OLD.contract_signed
     OR NEW.contract_signed_at IS DISTINCT FROM OLD.contract_signed_at THEN
    RAISE EXCEPTION 'El contrato de responsabilidad sólo lo marca Pagnol (super-admin).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.hardware_assigned IS DISTINCT FROM OLD.hardware_assigned THEN
    RAISE EXCEPTION 'La asignación de hardware sólo la registra Pagnol (super-admin).'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `tenant_id` es el RUT con el que se identifica la empresa en la plataforma.
  -- La pantalla de Configuración edita la columna `rut`, no ésta, así que
  -- congelarla no le quita nada al cliente.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'El identificador de la empresa no se modifica desde la aplicación.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'El id de la empresa es inmutable.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Nivel 2: configuración de la empresa — sólo quien la administra ───────
  -- Todo lo demás (nombre, RUT comercial, representante legal, dirección, faenas,
  -- logo, geocerca, correlativos, umbrales de criticidad y factor de costo laboral)
  -- es del cliente, pero no de cualquier trabajador suyo.
  IF NOT public.can_manage_tenant_settings() THEN
    RAISE EXCEPTION 'No tienes permisos para modificar la configuración de la empresa.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.prevent_tenant_platform_escalation() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_prevent_tenant_platform_escalation ON public.tenants;
CREATE TRIGGER trg_prevent_tenant_platform_escalation
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_tenant_platform_escalation();

COMMENT ON TRIGGER trg_prevent_tenant_platform_escalation ON public.tenants IS
  'Congela por nivel las columnas de `tenants`: las de plataforma (plan, is_active, '
  'contract_signed, hardware_assigned, tenant_id, id) sólo las mueve el super-admin; '
  'las de configuración, sólo quien administra esa empresa. La política RLS de UPDATE '
  'sigue dando acceso a la fila — no puede comparar OLD contra NEW, por eso el guard '
  'vive en un trigger.';

-- ── INSERT: cerrar la creación libre de empresas ────────────────────────────
-- `tenants_insert_authenticated` permitía a cualquier usuario autenticado crear
-- empresas ilimitadas. Hoy el registro real ocurre server-side con service role
-- (/api/register y /api/register/oauth), que no pasa por RLS, así que restringirlo
-- al super-admin no rompe el alta de clientes. Verificado en el E2E: el operador ya
-- recibía 403 en la práctica, pero la política declaraba lo contrario.
DROP POLICY IF EXISTS "tenants_insert_authenticated" ON public.tenants;
CREATE POLICY "tenants_insert_super_admin" ON public.tenants
  FOR INSERT WITH CHECK (public.is_super_admin());
