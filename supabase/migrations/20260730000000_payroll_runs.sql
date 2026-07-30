-- =============================================================================
-- Remuneraciones F3 — Planilla persistente (RFC-003 / ADR-009)
--
-- Hoy la liquidación vive en `useState` → PDF → se pierde. Esta migración le da
-- un lugar: planilla por período (`payroll_runs`) con una línea por trabajador
-- (`payroll_lines`), y amarra los anticipos de Wallet a la línea que los
-- descontó para que el doble descuento sea imposible POR ESQUEMA.
--
-- Estados (decisión 1 de Steven): borrador → cerrada → pagada.
--   borrador: se recalcula y se puede eliminar.
--   cerrada:  snapshot congelado. Art. 2 → corregir es una planilla NUEVA.
--   pagada:   con fecha real; es la transición que emitirá el hecho `paid` en F4.
--
-- ⚠️ ORDEN DE DECLARACIÓN: las funciones van ANTES de las políticas que las
-- invocan. Postgres exige que existan al crear la política, y el editor SQL corre
-- el lote en una transacción: un error tardío revierte hasta las tablas y la
-- ejecución "parece" haber funcionado. Ya pasó con la migración de F1.
-- =============================================================================

-- ── 1. Planilla del período ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payroll_runs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- Primer día del mes liquidado. Igual que finance_period_events.period_month:
    -- un mes es un mes, no un rango arbitrario.
    period_month    date NOT NULL,
    status          text NOT NULL DEFAULT 'borrador'
                    CHECK (status IN ('borrador', 'cerrada', 'pagada')),

    -- Snapshot de la paramétrica usada. Se copia al CERRAR: mientras es borrador
    -- puede recalcularse con parámetros nuevos, una vez cerrada jamás cambia.
    parameters_snapshot jsonb,
    uf_value        numeric,
    utm_value       numeric,

    -- Totales, para no sumar N líneas en cada listado
    total_taxable   numeric NOT NULL DEFAULT 0,
    total_earnings  numeric NOT NULL DEFAULT 0,
    total_deductions numeric NOT NULL DEFAULT 0,
    total_net       numeric NOT NULL DEFAULT 0,
    /** Costo empresa (incluye SIS y AFC del empleador): insumo del ledger en F4. */
    total_employer_cost numeric NOT NULL DEFAULT 0,
    worker_count    integer NOT NULL DEFAULT 0,

    closed_at       timestamptz,
    closed_by       uuid,
    closed_by_name  text,
    paid_at         timestamptz,
    /** Fecha de pago REAL (no el timestamp del click): la que verá el flujo de caja. */
    payment_date    date,
    paid_by         uuid,
    paid_by_name    text,
    notes           text,
    created_by      uuid,
    created_by_name text,
    created_at      timestamptz NOT NULL DEFAULT now(),

    -- Una sola planilla viva por mes y tenant. Si hay que corregir una cerrada,
    -- se anula y se crea otra: el UNIQUE fuerza a que esa decisión sea explícita.
    UNIQUE (tenant_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_lookup
    ON public.payroll_runs (tenant_id, period_month DESC);

-- ── 2. Una línea por trabajador ──────────────────────────────────────────────
-- Campos clave como columnas (reportes + ledger de F4) y snapshot jsonb de la
-- entrada y el resultado completo (ADR-009 §4): la planilla NO recalcula al
-- leerse, muestra lo que guardó.
CREATE TABLE IF NOT EXISTS public.payroll_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    run_id          uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    /** Nombre congelado: si el perfil cambia, la liquidación emitida no miente. */
    user_name       text NOT NULL,
    /** Contrato laboral vigente usado. RESTRICT: no se borra lo que respalda una liquidación. */
    employment_contract_id uuid REFERENCES public.employment_contracts(id) ON DELETE RESTRICT,

    worked_days     integer NOT NULL DEFAULT 0,
    overtime_hours  numeric NOT NULL DEFAULT 0,

    -- Haberes
    base_salary_earned numeric NOT NULL DEFAULT 0,
    overtime_amount numeric NOT NULL DEFAULT 0,
    gratification   numeric NOT NULL DEFAULT 0,
    total_taxable   numeric NOT NULL DEFAULT 0,
    family_allowance numeric NOT NULL DEFAULT 0,
    total_non_taxable numeric NOT NULL DEFAULT 0,
    total_earnings  numeric NOT NULL DEFAULT 0,
    -- Descuentos
    pension_amount  numeric NOT NULL DEFAULT 0,
    pension_commission numeric NOT NULL DEFAULT 0,
    health_amount   numeric NOT NULL DEFAULT 0,
    health_additional numeric NOT NULL DEFAULT 0,
    unemployment_amount numeric NOT NULL DEFAULT 0,
    income_tax      numeric NOT NULL DEFAULT 0,
    advances_amount numeric NOT NULL DEFAULT 0,
    total_deductions numeric NOT NULL DEFAULT 0,
    net_pay         numeric NOT NULL DEFAULT 0,
    -- Costo empleador (F4)
    employer_sis    numeric NOT NULL DEFAULT 0,
    employer_unemployment numeric NOT NULL DEFAULT 0,
    employer_cost   numeric NOT NULL DEFAULT 0,

    /** Entrada exacta del motor: permite reproducir el cálculo tal cual se emitió. */
    input_snapshot  jsonb,
    /** Resultado completo, incluidos los avisos que vio quien cerró. */
    result_snapshot jsonb,
    warnings        text[],
    created_at      timestamptz NOT NULL DEFAULT now(),

    UNIQUE (run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON public.payroll_lines (run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_user ON public.payroll_lines (tenant_id, user_id);

-- ── 3. Anticipos: amarre a la línea que los descontó (ADR-009 §3) ────────────
-- El hallazgo 2 del RFC-003 era que los anticipos no llegan a la liquidación y
-- se pueden pagar dos veces. Con esta columna, "ya descontado" es un dato, no
-- una suposición: un anticipo con payroll_line_id NO vuelve a ofrecerse.
-- ON DELETE SET NULL: si se elimina un borrador, sus anticipos vuelven a estar
-- disponibles automáticamente.
ALTER TABLE public.salary_advances
    ADD COLUMN IF NOT EXISTS payroll_line_id uuid
    REFERENCES public.payroll_lines(id) ON DELETE SET NULL;

-- OJO: la columna de la BD se llama `user_id`, aunque el tipo TS la expone como
-- `workerId`. Guiarse por el nombre del tipo es exactamente cómo se cuela un
-- drift; ver la migración de reparación 20260730010000.
CREATE INDEX IF NOT EXISTS idx_salary_advances_unsettled
    ON public.salary_advances (tenant_id, user_id)
    WHERE payroll_line_id IS NULL;

-- ── 4. Quién puede ver y operar la planilla ──────────────────────────────────
-- El sueldo es el dato más sensible del tenant. Ver la planilla completa exige
-- administrar RRHH; cada trabajador ve SUS propias líneas y nada más.
-- can_manage_hr() ya existe (migración de F1) y se reutiliza tal cual.
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payroll_runs_select" ON public.payroll_runs;
CREATE POLICY "payroll_runs_select" ON public.payroll_runs FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
    -- Un trabajador ve la cabecera solo si tiene una línea en ella, y solo si ya
    -- se cerró: un borrador no debe existir para él.
    OR EXISTS (
        SELECT 1 FROM public.payroll_lines l
         WHERE l.run_id = payroll_runs.id
           AND l.user_id = auth.uid()
           AND payroll_runs.status <> 'borrador'
    )
);

DROP POLICY IF EXISTS "payroll_runs_insert" ON public.payroll_runs;
CREATE POLICY "payroll_runs_insert" ON public.payroll_runs FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

-- UPDATE existe (borrador → cerrada → pagada) pero el trigger de más abajo impide
-- que toque una planilla ya cerrada.
DROP POLICY IF EXISTS "payroll_runs_update" ON public.payroll_runs;
CREATE POLICY "payroll_runs_update" ON public.payroll_runs FOR UPDATE TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

-- DELETE solo de borradores; el trigger lo verifica.
DROP POLICY IF EXISTS "payroll_runs_delete" ON public.payroll_runs;
CREATE POLICY "payroll_runs_delete" ON public.payroll_runs FOR DELETE TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_runs TO authenticated;

DROP POLICY IF EXISTS "payroll_lines_select" ON public.payroll_lines;
CREATE POLICY "payroll_lines_select" ON public.payroll_lines FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR user_id = auth.uid()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
);

DROP POLICY IF EXISTS "payroll_lines_insert" ON public.payroll_lines;
CREATE POLICY "payroll_lines_insert" ON public.payroll_lines FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

-- Las líneas se REEMPLAZAN al recalcular un borrador (delete + insert), nunca se
-- editan: sin política de UPDATE, y el trigger protege las de planilla cerrada.
DROP POLICY IF EXISTS "payroll_lines_delete" ON public.payroll_lines;
CREATE POLICY "payroll_lines_delete" ON public.payroll_lines FOR DELETE TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

GRANT SELECT, INSERT, DELETE ON public.payroll_lines TO authenticated;

-- ── 5. Art. 2 en la BASE, no solo en el cliente ──────────────────────────────
-- Igual que el trigger de cierre de período (ADR-006): la inmutabilidad tiene que
-- valer también para el service role y para cualquier script. Una liquidación
-- emitida que se puede editar no es un documento, es un borrador con otro nombre.
CREATE OR REPLACE FUNCTION public.payroll_run_guard()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'borrador' THEN
            RAISE EXCEPTION 'No se puede eliminar una planilla %: solo los borradores. Corregir una planilla cerrada es crear una nueva (Art. 2).', OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    -- UPDATE: desde 'cerrada' solo se permite avanzar a 'pagada' y escribir los
    -- campos del pago. Cualquier otro cambio falsearía un documento ya emitido.
    IF OLD.status = 'pagada' THEN
        RAISE EXCEPTION 'La planilla del período % ya está pagada: no admite cambios.', to_char(OLD.period_month, 'YYYY-MM');
    END IF;

    IF OLD.status = 'cerrada' THEN
        IF NEW.status <> 'pagada' THEN
            RAISE EXCEPTION 'Una planilla cerrada solo puede pasar a pagada (intento: %).', NEW.status;
        END IF;
        IF NEW.total_net <> OLD.total_net OR NEW.total_earnings <> OLD.total_earnings
           OR NEW.total_deductions <> OLD.total_deductions OR NEW.period_month <> OLD.period_month
           OR NEW.parameters_snapshot IS DISTINCT FROM OLD.parameters_snapshot THEN
            RAISE EXCEPTION 'No se pueden alterar los montos ni el período de una planilla cerrada (Art. 2).';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION public.payroll_run_guard() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS payroll_runs_guard ON public.payroll_runs;
CREATE TRIGGER payroll_runs_guard
    BEFORE UPDATE OR DELETE ON public.payroll_runs
    FOR EACH ROW EXECUTE FUNCTION public.payroll_run_guard();

-- Las líneas de una planilla que ya no es borrador son intocables.
CREATE OR REPLACE FUNCTION public.payroll_line_guard()
RETURNS trigger AS $$
DECLARE
    st text;
BEGIN
    SELECT status INTO st FROM public.payroll_runs
     WHERE id = COALESCE(NEW.run_id, OLD.run_id);
    IF st IS NOT NULL AND st <> 'borrador' THEN
        RAISE EXCEPTION 'La planilla ya está %: sus líneas no se pueden modificar ni eliminar (Art. 2).', st;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
ALTER FUNCTION public.payroll_line_guard() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS payroll_lines_guard ON public.payroll_lines;
CREATE TRIGGER payroll_lines_guard
    BEFORE INSERT OR DELETE ON public.payroll_lines
    FOR EACH ROW EXECUTE FUNCTION public.payroll_line_guard();

-- Realtime: la planilla se consulta por página (no vía useSupabaseCollection),
-- así que NO se agrega a la publicación. Es una decisión, no un olvido.

NOTIFY pgrst, 'reload schema';
