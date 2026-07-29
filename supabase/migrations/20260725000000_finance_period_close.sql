-- =============================================================================
-- Dominio Financiero F4.1 — Cierre de período (RFC-002-F4-Plan)
--
-- Sin cierre, todo lo construido en F0–F3 sigue siendo mutable hacia atrás: un
-- hecho fechado en enero puede nacer en julio y cambiar un margen ya reportado.
-- El soft-lock congela el pasado.
--
-- Decisión de Steven (D1): el ledger RECHAZA el hecho y quien lo intentó lo
-- REPORTA. No se redirige la fecha (mentiría sobre cuándo ocurrió) ni se acota
-- en silencio la ventana del cron (perdería el dato sin que nadie se entere).
--
-- Compatibilidad ya verificada con el resto del dominio:
--   · finance_reverse_source emite con CURRENT_DATE  → cae en período abierto ✅
--   · labor-cost / finance-accruals fechan HACIA ATRÁS → serán rechazados y lo
--     reportan (`blocked`), que es exactamente lo que D1 pide.
-- =============================================================================

-- ── 1. Eventos de cierre (append-only, como todo el dominio) ─────────────────
-- Una fila por acción, no un estado editable: cerrar → reabrir → cerrar deja
-- las tres, con autor y motivo. El estado vigente es el último evento.
CREATE TABLE IF NOT EXISTS public.finance_period_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    -- Primer día del mes: el período es mensual (RFC-002).
    period_month    date NOT NULL,
    action          text NOT NULL CHECK (action IN ('close', 'reopen')),
    -- Obligatorio al reabrir (reabrir un mes cerrado necesita justificación).
    reason          text,
    created_by      uuid,
    created_by_name text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- El guard consulta "último evento del mes" en cada INSERT del ledger: el índice
-- ordena por created_at DESC para que sea una lectura de una fila.
CREATE INDEX IF NOT EXISTS idx_finance_period_events_lookup
    ON public.finance_period_events (tenant_id, period_month, created_at DESC);

ALTER TABLE public.finance_period_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance_period_events_select" ON public.finance_period_events;
CREATE POLICY "finance_period_events_select" ON public.finance_period_events FOR SELECT TO authenticated
USING (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id()
        AND (public.is_finance_viewer() OR public.can_manage_finance())));

-- Cerrar/reabrir exige finance:manage ("Administrar Finanzas (presupuestos, cierres)").
DROP POLICY IF EXISTS "finance_period_events_insert" ON public.finance_period_events;
CREATE POLICY "finance_period_events_insert" ON public.finance_period_events FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin()
    OR (tenant_id = public.get_my_tenant_id() AND public.can_manage_finance()));

-- Append-only: sin UPDATE/DELETE (ni política ni GRANT).
GRANT SELECT, INSERT ON public.finance_period_events TO authenticated;

-- ── 2. ¿Está cerrado el período que contiene esta fecha? ─────────────────────
-- SECURITY DEFINER: el guard debe poder decidir aunque el emisor no pueda LEER
-- los eventos (un pañolero recepcionando no es visor financiero).
CREATE OR REPLACE FUNCTION public.is_period_closed(p_tenant uuid, p_date date)
RETURNS boolean AS $$
  SELECT COALESCE(
    (SELECT e.action = 'close'
       FROM public.finance_period_events e
      WHERE e.tenant_id = p_tenant
        AND e.period_month = date_trunc('month', p_date)::date
      ORDER BY e.created_at DESC
      LIMIT 1),
    false);
$$ LANGUAGE sql SECURITY DEFINER STABLE;
ALTER FUNCTION public.is_period_closed(uuid, date) SET search_path = public, extensions;
GRANT EXECUTE ON FUNCTION public.is_period_closed(uuid, date) TO authenticated;

-- ── 3. El guard ──────────────────────────────────────────────────────────────
-- Va en la BASE y no en los emisores: hay nueve emisores y dos crons, y el
-- congelamiento del pasado no puede depender de que todos recuerden chequear.
-- Aplica también al service role (el cron de MO es justamente quien más lo va a
-- topar) — así el rechazo es real y el cron lo puede reportar.
CREATE OR REPLACE FUNCTION public.finance_entries_period_guard()
RETURNS trigger AS $$
DECLARE
  v_closed_at timestamptz;
  v_by        text;
BEGIN
  IF public.is_period_closed(NEW.tenant_id, NEW.entry_date) THEN
    SELECT e.created_at, e.created_by_name INTO v_closed_at, v_by
      FROM public.finance_period_events e
     WHERE e.tenant_id = NEW.tenant_id
       AND e.period_month = date_trunc('month', NEW.entry_date)::date
     ORDER BY e.created_at DESC
     LIMIT 1;
    RAISE EXCEPTION
      'Período % cerrado el % por %: no se pueden registrar hechos financieros con esa fecha contable. Reabre el período o corrige con fecha del período abierto.',
      to_char(NEW.entry_date, 'MM/YYYY'),
      to_char(v_closed_at, 'DD/MM/YYYY'),
      COALESCE(v_by, 'la administración')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
ALTER FUNCTION public.finance_entries_period_guard() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS trg_finance_entries_period_guard ON public.finance_entries;
CREATE TRIGGER trg_finance_entries_period_guard
    BEFORE INSERT ON public.finance_entries
    FOR EACH ROW EXECUTE FUNCTION public.finance_entries_period_guard();

-- El presupuesto NO se bloquea: es intención, no un hecho ocurrido, y se
-- replanifica hacia adelante aunque el mes esté cerrado (ADR-005).

-- ── 4. Chequeo previo al cierre ──────────────────────────────────────────────
-- Cerrar sobre datos incompletos es peor que no cerrar: el mes queda congelado
-- con costos que faltaban. Esto muestra la foto ANTES de confirmar; no bloquea
-- (el usuario decide), pero nadie cierra a ciegas.
CREATE OR REPLACE FUNCTION public.finance_period_precheck(
    p_month  date,
    p_tenant uuid DEFAULT NULL
) RETURNS TABLE (
    kind     text,     -- identificador estable para la UI
    severity text,     -- 'warning' (costo que faltaría) | 'info' (solo aviso)
    detail   text,
    count    bigint,
    amount   numeric
)
LANGUAGE plpgsql STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := CASE
      WHEN public.is_super_admin() AND p_tenant IS NOT NULL THEN p_tenant
      ELSE public.get_my_tenant_id()
  END;
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant.'; END IF;

  -- (a) Asistencia sin sueldo base ⇒ esos días NO están en el ledger (ADR-003:
  --     no se inventa un costo $0). Cerrar ahora los congela sin costo de MO.
  RETURN QUERY
  SELECT 'attendance_without_salary', 'warning',
         'Días con asistencia de trabajadores sin sueldo base configurado: su costo de mano de obra NO está en el ledger.',
         COUNT(*)::bigint, NULL::numeric
    FROM (SELECT DISTINCT a.date, a.user_id
            FROM public.attendance_logs a
            JOIN public.profiles p ON p.id = a.user_id
           WHERE a.tenant_id = v_tenant
             AND a.date BETWEEN v_from AND v_to
             AND COALESCE(p.base_salary, 0) <= 0) s
   HAVING COUNT(*) > 0;

  -- (b) Ciclos de arriendo vencidos en el mes que nunca se devengaron.
  RETURN QUERY
  SELECT 'rental_cycle_not_accrued', 'warning',
         'Ciclos de arriendo vencidos en el período sin devengo en el ledger.',
         COUNT(*)::bigint, COALESCE(SUM(rp.amount), 0)
    FROM public.rental_payments rp
   WHERE rp.tenant_id = v_tenant
     AND rp.due_date BETWEEN v_from AND v_to
     AND NOT EXISTS (
       SELECT 1 FROM public.finance_entries fe
        WHERE fe.tenant_id = v_tenant
          AND fe.source_type = 'rental_payment'
          AND fe.source_id = rp.id::text
          AND fe.stage = 'accrued')
  HAVING COUNT(*) > 0;

  -- (c) Estados de pago aprobados y no cobrados (informativo: el ingreso ya está
  --     devengado; solo avisa que la caja sigue pendiente).
  RETURN QUERY
  SELECT 'payment_state_uncollected', 'info',
         'Estados de pago aprobados en el período aún sin cobrar.',
         COUNT(*)::bigint, COALESCE(SUM(ps.period_earned), 0)
    FROM public.payment_states ps
   WHERE ps.tenant_id = v_tenant
     AND ps.approved_at::date BETWEEN v_from AND v_to
     AND ps.paid_at IS NULL
     AND ps.annulled_at IS NULL
  HAVING COUNT(*) > 0;

  -- (d) Meses anteriores sin cerrar: cerrar julio dejando junio abierto permite
  --     que junio siga recibiendo hechos, y el histórico "cerrado" es ilusorio.
  RETURN QUERY
  SELECT 'earlier_month_open', 'warning',
         'Hay meses anteriores con hechos en el ledger que siguen abiertos.',
         COUNT(DISTINCT date_trunc('month', fe.entry_date))::bigint, NULL::numeric
    FROM public.finance_entries fe
   WHERE fe.tenant_id = v_tenant
     AND fe.entry_date < v_from
     AND NOT public.is_period_closed(v_tenant, fe.entry_date)
  HAVING COUNT(*) > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.finance_period_precheck(date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
