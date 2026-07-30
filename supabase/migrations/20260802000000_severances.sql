-- =============================================================================
-- Remuneraciones F5 — Finiquitos persistentes (RFC-003 / ADR-012)
--
-- Cierra el hallazgo 3 del RFC-003 para el último documento que faltaba: hoy
-- `attendance/severance` calcula en `useState`, imprime un PDF y no guarda nada.
-- Un finiquito ya se emitió así en el tenant real (prueba del 14-07-2026): el
-- único registro que quedó fue el PDF en la carpeta de Descargas de quien lo
-- generó.
--
-- Un finiquito es un documento con efectos legales y tributarios, y además el
-- desembolso más grande que una empresa hace por un trabajador. Va con la misma
-- disciplina que la planilla (ADR-009): estados, snapshot inmutable y Art. 2
-- por trigger en la base.
--
-- Decisiones de Steven (ADR-012): emite al ledger igual que la planilla ·
-- incluye la liquidación del último mes · el feriado se proyecta en calendario
-- real con tabla de festivos.
-- =============================================================================

-- ── 1. Festivos legales ──────────────────────────────────────────────────────
-- El feriado proporcional se paga en días CORRIDOS: se proyectan los días
-- hábiles desde el día siguiente al término y se suman los sábados, domingos y
-- festivos que el período atraviese (art. 69 + criterio DT). Sin esta tabla, un
-- período que cruza un feriado paga de menos — y siempre en contra del
-- trabajador.
--
-- Nacional y global, como uf_rates: un feriado legal no depende del tenant.
CREATE TABLE IF NOT EXISTS public.public_holidays (
    holiday_date     date PRIMARY KEY,
    name             text NOT NULL,
    -- Irrenunciable = comercio cerrado. No cambia el cálculo del feriado (todo
    -- festivo es inhábil), pero es el dato que distingue unos de otros y sirve
    -- para turnos y asistencia.
    is_irrenunciable boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_holidays_select" ON public.public_holidays;
CREATE POLICY "public_holidays_select" ON public.public_holidays FOR SELECT TO authenticated USING (true);
-- Sin INSERT/UPDATE para authenticated: es normativa nacional, no dato de tenant.
GRANT SELECT ON public.public_holidays TO authenticated;

-- Feriados legales de Chile 2026 (verificados contra dos fuentes independientes,
-- ver ADR-012). ⚠️ Hay que sembrar cada año nuevo: no existe un endpoint oficial
-- y los móviles (Semana Santa) y trasladables cambian de fecha.
INSERT INTO public.public_holidays (holiday_date, name, is_irrenunciable) VALUES
    ('2026-01-01', 'Año Nuevo',                          true),
    ('2026-04-03', 'Viernes Santo',                       false),
    ('2026-04-04', 'Sábado Santo',                        false),
    ('2026-05-01', 'Día Nacional del Trabajo',            true),
    ('2026-05-21', 'Día de las Glorias Navales',          false),
    ('2026-06-29', 'San Pedro y San Pablo',               false),
    ('2026-07-16', 'Virgen del Carmen',                   false),
    ('2026-08-15', 'Asunción de la Virgen',               false),
    ('2026-09-18', 'Independencia Nacional',              true),
    ('2026-09-19', 'Día de las Glorias del Ejército',     true),
    ('2026-10-12', 'Encuentro de Dos Mundos',             false),
    ('2026-10-31', 'Día de las Iglesias Evangélicas',     false),
    ('2026-11-01', 'Día de Todos los Santos',             false),
    ('2026-12-08', 'Inmaculada Concepción',               false),
    ('2026-12-25', 'Navidad',                             true)
ON CONFLICT (holiday_date) DO NOTHING;

-- ── 2. Finiquitos ────────────────────────────────────────────────────────────
-- Una fila por finiquito. A diferencia de la planilla no hay cabecera + líneas:
-- el finiquito es de UN trabajador, así que la cabecera ES el documento.
CREATE TABLE IF NOT EXISTS public.severances (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    user_name            text NOT NULL,
    -- Contrato laboral que respalda la base de cálculo. RESTRICT: no se borra un
    -- contrato que un finiquito emitido está citando.
    employment_contract_id uuid REFERENCES public.employment_contracts(id) ON DELETE RESTRICT,

    status               text NOT NULL DEFAULT 'borrador'
                         CHECK (status IN ('borrador', 'cerrado', 'pagado')),

    -- ── Entradas del cálculo
    start_date           date NOT NULL,          -- ingreso a la empresa
    end_date             date NOT NULL,          -- término del contrato
    cause                text NOT NULL,
    notice_given         boolean NOT NULL DEFAULT false,
    -- Base del art. 172 (incluye cotizaciones del trabajador y regalías; excluye
    -- horas extra, asignación familiar y beneficios esporádicos).
    last_remuneration    numeric NOT NULL,
    uf_value             numeric,
    vacation_days_taken  numeric NOT NULL DEFAULT 0,
    -- Feriado progresivo ACREDITADO por el trabajador (art. 68). Se declara: el
    -- derecho exige 10 años con uno o más empleadores, y los anteriores no los
    -- conoce este sistema.
    progressive_days     numeric NOT NULL DEFAULT 0,
    deductions           jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Liquidación del último mes, tomada de la planilla en vez de recalculada
    -- (decisión de Steven). Sin FK obligatoria: puede finiquitarse antes de que
    -- exista la planilla del mes.
    last_payroll_run_id  uuid REFERENCES public.payroll_runs(id) ON DELETE SET NULL,
    last_payroll_net     numeric NOT NULL DEFAULT 0,

    -- ── Resultado (mismo criterio que payroll_lines: se guarda desglosado para
    -- poder imprimirlo y auditarlo sin recalcular)
    years_of_service     numeric NOT NULL DEFAULT 0,
    indemnifiable_years  numeric NOT NULL DEFAULT 0,
    capped_base          numeric NOT NULL DEFAULT 0,
    indemnity_years      numeric NOT NULL DEFAULT 0,
    indemnity_notice     numeric NOT NULL DEFAULT 0,
    vacation_days_habiles numeric NOT NULL DEFAULT 0,
    vacation_days_corridos numeric NOT NULL DEFAULT 0,
    vacation_pay         numeric NOT NULL DEFAULT 0,
    total_earnings       numeric NOT NULL DEFAULT 0,
    total_deductions     numeric NOT NULL DEFAULT 0,
    total_severance      numeric NOT NULL DEFAULT 0,

    -- Snapshot: reproducir exactamente lo que se emitió, aunque cambien las
    -- tasas, los festivos o el contrato (ADR-009 §4).
    input_snapshot       jsonb,
    result_snapshot      jsonb,
    warnings             jsonb NOT NULL DEFAULT '[]'::jsonb,

    closed_at            timestamptz,
    closed_by            uuid,
    closed_by_name       text,
    paid_at              timestamptz,
    payment_date         date,
    paid_by              uuid,
    paid_by_name         text,
    notes                text,
    created_by           uuid,
    created_by_name      text,
    created_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT severance_dates_ordered CHECK (end_date >= start_date),
    CONSTRAINT severance_remuneration_positive CHECK (last_remuneration >= 0)
);

CREATE INDEX IF NOT EXISTS idx_severances_tenant ON public.severances (tenant_id, end_date DESC);
CREATE INDEX IF NOT EXISTS idx_severances_user ON public.severances (user_id, end_date DESC);

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- Mismo criterio que la planilla: lo administra RRHH; el trabajador ve el suyo
-- solo una vez cerrado (un borrador no debe existir para él).
ALTER TABLE public.severances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "severances_select" ON public.severances;
CREATE POLICY "severances_select" ON public.severances FOR SELECT TO authenticated
USING (
    public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr())
    OR (user_id = auth.uid() AND status <> 'borrador')
);

DROP POLICY IF EXISTS "severances_insert" ON public.severances;
CREATE POLICY "severances_insert" ON public.severances FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

DROP POLICY IF EXISTS "severances_update" ON public.severances;
CREATE POLICY "severances_update" ON public.severances FOR UPDATE TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

DROP POLICY IF EXISTS "severances_delete" ON public.severances;
CREATE POLICY "severances_delete" ON public.severances FOR DELETE TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_hr()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.severances TO authenticated;

-- ── 4. Art. 2 en la BASE ─────────────────────────────────────────────────────
-- Igual que payroll_run_guard: vale para el service role y para cualquier
-- script. Un finiquito cerrado que se puede editar no es un documento.
CREATE OR REPLACE FUNCTION public.severance_guard()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'borrador' THEN
            RAISE EXCEPTION 'No se puede eliminar un finiquito %: solo los borradores. Corregir uno emitido es emitir otro (Art. 2).', OLD.status;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.status = 'pagado' THEN
        RAISE EXCEPTION 'El finiquito de % ya está pagado: no admite cambios.', OLD.user_name;
    END IF;

    IF OLD.status = 'cerrado' THEN
        IF NEW.status NOT IN ('cerrado', 'pagado') THEN
            RAISE EXCEPTION 'Un finiquito cerrado solo puede pasar a pagado (intento: %).', NEW.status;
        END IF;
        -- Cerrado congela el documento: solo se permite la marca de pago.
        IF NEW.total_severance IS DISTINCT FROM OLD.total_severance
           OR NEW.end_date IS DISTINCT FROM OLD.end_date
           OR NEW.start_date IS DISTINCT FROM OLD.start_date
           OR NEW.cause IS DISTINCT FROM OLD.cause
           OR NEW.last_remuneration IS DISTINCT FROM OLD.last_remuneration
           OR NEW.indemnity_years IS DISTINCT FROM OLD.indemnity_years
           OR NEW.indemnity_notice IS DISTINCT FROM OLD.indemnity_notice
           OR NEW.vacation_pay IS DISTINCT FROM OLD.vacation_pay THEN
            RAISE EXCEPTION 'No se pueden alterar los montos ni las fechas de un finiquito cerrado (Art. 2).';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.severance_guard() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS severances_guard ON public.severances;
CREATE TRIGGER severances_guard
    BEFORE UPDATE OR DELETE ON public.severances
    FOR EACH ROW EXECUTE FUNCTION public.severance_guard();

-- ── 5. Realtime ──────────────────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND tablename = 'severances'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.severances;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
