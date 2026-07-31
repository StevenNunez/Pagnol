-- =============================================================================
-- Wallet — control de acceso de `salary_advances`
--
-- La tabla entró en el barrido genérico de la migración consolidada
-- (20260612000001): una sola política `FOR ALL` con `tenant_id = mi tenant`.
-- Para casi todas las tablas eso alcanza; para ésta no, porque el sujeto del
-- dato es el trabajador y la operación mueve plata:
--
--   · CUALQUIER usuario autenticado del tenant LEÍA todos los anticipos —
--     nombre, monto y quién aprobó. Es información de sueldo, del mismo orden
--     que `payroll_lines`, que sí filtra por `user_id = auth.uid()`.
--   · CUALQUIER trabajador podía APROBARSE SU PROPIO ANTICIPO con un PATCH
--     directo a /rest/v1/salary_advances (tiene la anon key y su sesión). El
--     único control era que el botón vivía en otra página. Desde F3 un anticipo
--     aprobado se descuenta solo en la planilla: es plata que sale.
--   · Y podía insertar anticipos a nombre de otro, o borrarlos.
--
-- No hubo explotación posible hasta ahora porque el módulo nunca funcionó
-- (drift #6, reparado en 20260730010000) y la tabla está vacía en los cuatro
-- tenants. Se cierra antes de que se use, no después.
--
-- Criterio: mismo patrón que payroll_runs/payroll_lines (política por
-- operación) y misma disciplina del Art. 5 — quién puede hacer qué se decide
-- en la base, no en el render de un botón.
-- =============================================================================

-- ── 1. Quién administra anticipos ────────────────────────────────────────────
-- Se PRESERVA exactamente quién aprueba hoy —la pantalla vive en el módulo de
-- Pagos, así que `module_payments:view` es el permiso de facto— y se agrega
-- RRHH, que desde F3 es quien los descuenta en la planilla y los liquida en el
-- finiquito. A propósito NO se crea un permiso nuevo: los roles por-tenant de
-- la tabla `roles` congelan sus permisos, así que un permiso recién inventado
-- dejaría sin aprobar a tenants que hoy aprueban (el drift que documenta
-- feedback_admin_soporte_full_control).
CREATE OR REPLACE FUNCTION public.can_manage_advances()
RETURNS boolean AS $$
  SELECT public.can_manage_hr() OR EXISTS(
    SELECT 1
    FROM public.profiles p
    LEFT JOIN public.roles r
      ON r.id = p.role AND r.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (
            p.role IN ('super-admin', 'administrador', 'soporte-pagnol')
         OR to_jsonb(p.granted_permissions) ? 'module_payments:view'
         OR to_jsonb(r.permissions)         ? 'module_payments:view'
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.can_manage_advances() SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.can_manage_advances() TO authenticated;

-- ── 2. Políticas por operación ───────────────────────────────────────────────
ALTER TABLE public.salary_advances ENABLE ROW LEVEL SECURITY;

-- Se eliminan TODAS las previas: la del barrido se llama `salary_advances_tenant`,
-- pero el nombre depende de qué script tocó la tabla en cada ambiente.
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'salary_advances'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.salary_advances', pol.policyname);
  END LOOP;
END $$;

-- El trabajador ve LOS SUYOS; quien administra anticipos ve los de su tenant.
CREATE POLICY "salary_advances_select" ON public.salary_advances FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_advances())
);

-- Pedir: para uno mismo, o un administrador a nombre de un tercero. En ambos
-- casos NACE PENDIENTE y sin aprobador — sin esta condición el trabajador se
-- auto-aprueba en el mismo INSERT y la política de UPDATE no se entera.
CREATE POLICY "salary_advances_insert" ON public.salary_advances FOR INSERT TO authenticated
WITH CHECK (
    public.is_super_admin()
    OR (
        tenant_id = public.get_my_tenant_id()
        AND status = 'pending'
        AND approver_id IS NULL
        AND payroll_line_id IS NULL
        AND (user_id = auth.uid() OR public.can_manage_advances())
    )
);

-- Aprobar / rechazar / amarrar a una línea de planilla: solo quien administra.
-- `approver_id <> user_id` es la regla de los cuatro ojos: ni siquiera el
-- administrador aprueba su propia solicitud (el super-admin sí — control total
-- del sistema, y queda con su nombre estampado igual).
CREATE POLICY "salary_advances_update" ON public.salary_advances FOR UPDATE TO authenticated
USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_advances())
)
WITH CHECK (
    public.is_super_admin()
    OR (
        tenant_id = public.get_my_tenant_id()
        AND public.can_manage_advances()
        AND (approver_id IS NULL OR approver_id <> user_id)
    )
);

CREATE POLICY "salary_advances_delete" ON public.salary_advances FOR DELETE TO authenticated
USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_advances())
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_advances TO authenticated;

-- ── 3. Un anticipo resuelto no cambia de monto ───────────────────────────────
-- Mismo criterio que payroll_run_guard: vale también para el service role y
-- para cualquier script. Aprobar $50.000 y que después la fila diga $500.000
-- —o que un anticipo ya descontado en una planilla vuelva a "pendiente" para
-- cobrarse de nuevo— no puede depender de que nadie escriba ese UPDATE.
CREATE OR REPLACE FUNCTION public.salary_advance_guard()
RETURNS trigger AS $$
BEGIN
    IF OLD.status <> 'pending' THEN
        IF NEW.amount IS DISTINCT FROM OLD.amount
           OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.requested_at IS DISTINCT FROM OLD.requested_at THEN
            RAISE EXCEPTION 'El anticipo ya está %: no se puede cambiar el monto, el trabajador ni la fecha. Corregirlo es rechazarlo y pedir uno nuevo.', OLD.status;
        END IF;
        IF NEW.status = 'pending' THEN
            RAISE EXCEPTION 'Un anticipo % no vuelve a pendiente.', OLD.status;
        END IF;
    END IF;

    -- Un anticipo ya descontado en una planilla solo lo suelta el borrado del
    -- borrador (ON DELETE SET NULL). Reasignarlo a mano lo cobraría dos veces.
    IF OLD.payroll_line_id IS NOT NULL
       AND NEW.payroll_line_id IS NOT NULL
       AND NEW.payroll_line_id <> OLD.payroll_line_id THEN
        RAISE EXCEPTION 'El anticipo ya fue descontado en una liquidación: no se puede reasignar a otra.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION public.salary_advance_guard() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS salary_advances_guard ON public.salary_advances;
CREATE TRIGGER salary_advances_guard
    BEFORE UPDATE ON public.salary_advances
    FOR EACH ROW EXECUTE FUNCTION public.salary_advance_guard();

NOTIFY pgrst, 'reload schema';
