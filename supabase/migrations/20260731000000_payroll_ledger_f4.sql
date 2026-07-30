-- =============================================================================
-- Remuneraciones F4 — El costo real reemplaza la estimación (RFC-003 / ADR-010)
--
-- Hasta ahora el ledger devengaba una ESTIMACIÓN de mano de obra
-- (`labor_day` = sueldo/30 × 1,35 × días, ADR-003) y la planilla real de F3 no
-- llegaba al dominio financiero: la desviación contra el presupuesto comparaba
-- contra un proxy, no contra lo que se pagó.
--
-- Esta migración aporta las dos piezas que el cierre de planilla necesita en la
-- base, y un chequeo para que el orden correcto sea el fácil.
--
-- ⚠️ ORDEN: las funciones van antes de cualquier consumidor. El editor SQL corre
-- el lote en una transacción y un error tardío revierte TODO en silencio.
-- =============================================================================

-- ── 1. Reverso de la estimación de un mes completo ───────────────────────────
-- `finance_reverse_source` reversa UN documento y fecha el espejo con
-- CURRENT_DATE a propósito, para no chocar con períodos cerrados. Acá hace falta
-- lo contrario y por eso es una función propia:
--
--   · La estimación de MO vive como N hechos (uno por día-persona), con
--     source_id = '{userId}:{yyyy-MM-dd}'. Reversarlos de a uno serían cientos de
--     llamadas RPC por planilla.
--   · El espejo DEBE fecharse en el mes liquidado. Si se fechara hoy, mayo
--     mostraría la estimación sin su reverso mientras julio muestra ambos, y el
--     margen mensual mentiría en los dos meses.
--
-- Consecuencia asumida y documentada en ADR-010: como el espejo cae en el mes
-- liquidado, ese mes NO puede estar contablemente cerrado. De ahí la regla
-- "cerrar la planilla antes de cerrar el período", que el chequeo (3) recuerda y
-- el guard de `closePayrollRun` impone.
--
-- DUPLICACIÓN CONSCIENTE con finance_reverse_source: si una cambia, revisar la
-- otra (misma nota que is_period_closed / closedMonthsFromEvents).
CREATE OR REPLACE FUNCTION public.finance_reverse_labor_month(
    p_month   date,
    p_reason  text,
    p_user_ids uuid[] DEFAULT NULL,
    p_tenant  uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := CASE
      WHEN public.is_super_admin() AND p_tenant IS NOT NULL THEN p_tenant
      ELSE public.get_my_tenant_id()
  END;
  v_month_txt text := to_char(date_trunc('month', p_month), 'YYYY-MM');
  -- Último día del mes: el espejo se fecha ahí, no hoy.
  v_entry_date date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_name  text;
  v_count integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant.';
  END IF;
  -- Solo quien administra RRHH puede apagar la estimación de un mes.
  IF NOT (public.is_super_admin() OR public.can_manage_hr()) THEN
    RAISE EXCEPTION 'No tienes permiso para reemplazar el costo de mano de obra.';
  END IF;
  IF public.is_period_closed(v_tenant, v_entry_date) THEN
    RAISE EXCEPTION 'El período % está cerrado: no se puede reemplazar su costo de mano de obra. Reabre el período o liquida en el mes siguiente.', v_month_txt;
  END IF;

  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();

  WITH live AS (
    SELECT source_id, nature, stage, category, contract_id, contract_name, tax_rate,
           counterparty_type, counterparty_id, counterparty_name,
           MAX(source_code) AS source_code,
           SUM(amount_net)  AS net,
           MIN(id::text)::uuid AS first_id
      FROM public.finance_entries
     WHERE tenant_id = v_tenant
       AND source_type = 'labor_day'
       -- El mes sale del SUFIJO del source_id (el día trabajado), no de
       -- entry_date: un hecho reconciliado pudo emitirse otro día.
       AND right(source_id, 10) LIKE v_month_txt || '-%'
       AND (p_user_ids IS NULL OR left(source_id, length(source_id) - 11)::uuid = ANY (p_user_ids))
     GROUP BY source_id, nature, stage, category, contract_id, contract_name, tax_rate,
              counterparty_type, counterparty_id, counterparty_name
    HAVING SUM(amount_net) <> 0
  )
  INSERT INTO public.finance_entries (
    tenant_id, entry_date, nature, stage, category,
    amount_net, currency, amount_original, fx_rate, tax_rate,
    contract_id, contract_name, source_type, source_id, source_code,
    counterparty_type, counterparty_id, counterparty_name,
    reversal_of, notes, created_by, created_by_name
  )
  SELECT v_tenant, v_entry_date, nature, stage, category,
         -net, 'CLP', -net, 1, tax_rate,
         contract_id, contract_name, 'labor_day', source_id, source_code,
         counterparty_type, counterparty_id, counterparty_name,
         first_id, p_reason, auth.uid(), v_name
    FROM live;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finance_reverse_labor_month(date, text, uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finance_reverse_labor_month(date, text, uuid[], uuid) TO authenticated;

-- ── 2. Días de estimación por obra, para repartir el costo real ──────────────
-- El reparto es proporcional a los días de cada contrato (decisión 2 de ADR-010)
-- y esos días ya están en el ledger: cada `labor_day` guarda el contract_id que
-- el scan resolvió ese día. Se expone agregado para no traer N filas al cliente.
--
-- SECURITY DEFINER porque quien cierra la planilla administra RRHH pero no
-- necesariamente puede LEER finance_entries (misma asimetría que resuelve
-- finance_reverse_source). Valida tenant y permiso por dentro.
CREATE OR REPLACE FUNCTION public.labor_days_by_contract(
    p_month   date,
    p_user_ids uuid[] DEFAULT NULL,
    p_tenant  uuid DEFAULT NULL
) RETURNS TABLE (
    user_id       uuid,
    contract_id   uuid,
    contract_name text,
    days          bigint,
    estimated_net numeric
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := CASE
      WHEN public.is_super_admin() AND p_tenant IS NOT NULL THEN p_tenant
      ELSE public.get_my_tenant_id()
  END;
  v_month_txt text := to_char(date_trunc('month', p_month), 'YYYY-MM');
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sin tenant.'; END IF;
  IF NOT (public.is_super_admin() OR public.can_manage_hr()) THEN
    RAISE EXCEPTION 'No tienes permiso para leer el costo de mano de obra.';
  END IF;

  RETURN QUERY
  SELECT (left(fe.source_id, length(fe.source_id) - 11))::uuid AS user_id,
         fe.contract_id,
         COALESCE(MAX(c.name), MAX(fe.contract_name)) AS contract_name,
         -- Un día cuenta una vez aunque tenga espejo + re-emisión: se cuentan
         -- los source_id DISTINTOS que quedaron con neto vivo.
         COUNT(DISTINCT fe.source_id)::bigint AS days,
         SUM(fe.amount_net) AS estimated_net
    FROM public.finance_entries fe
    LEFT JOIN public.contracts c ON c.id = fe.contract_id
   WHERE fe.tenant_id = v_tenant
     AND fe.source_type = 'labor_day'
     AND right(fe.source_id, 10) LIKE v_month_txt || '-%'
     AND (p_user_ids IS NULL OR (left(fe.source_id, length(fe.source_id) - 11))::uuid = ANY (p_user_ids))
   GROUP BY 1, 2
  HAVING SUM(fe.amount_net) <> 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.labor_days_by_contract(date, uuid[], uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.labor_days_by_contract(date, uuid[], uuid) TO authenticated;

-- ── 3. El precheck avisa de planillas sin cerrar ─────────────────────────────
-- El costo real solo puede entrar al mes liquidado si ese mes sigue abierto. Si
-- se cierra el período con la planilla en borrador, el mes queda con la
-- ESTIMACIÓN congelada y ya no se puede reemplazar sin reabrir. Este chequeo
-- hace que el orden correcto (planilla → período) sea el evidente.
-- ⚠️ La firma debe ser IDÉNTICA a la de 20260725000000: `CREATE OR REPLACE` no
-- puede cambiar los nombres de las columnas de salida, y renombrarlas rompería a
-- `finanzas/cierre`, que lee `w.kind`, `w.detail` y `w.count`. Tampoco se le
-- agrega SECURITY DEFINER: la original es INVOKER y hereda el RLS de quien
-- pregunta, que es lo correcto para una consulta informativa.
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

  -- (c) Estados de pago aprobados y no cobrados (informativo).
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

  -- (d) Meses anteriores sin cerrar.
  RETURN QUERY
  SELECT 'earlier_month_open', 'warning',
         'Hay meses anteriores con hechos en el ledger que siguen abiertos.',
         COUNT(DISTINCT date_trunc('month', fe.entry_date))::bigint, NULL::numeric
    FROM public.finance_entries fe
   WHERE fe.tenant_id = v_tenant
     AND fe.entry_date < v_from
     AND NOT public.is_period_closed(v_tenant, fe.entry_date)
  HAVING COUNT(*) > 0;

  -- (e) NUEVO F4: planilla del mes sin cerrar. Si se cierra el período así, el
  --     costo de personal del mes queda como ESTIMACIÓN para siempre (salvo
  --     reabrir), porque el reemplazo tiene que escribir en este mes.
  RETURN QUERY
  SELECT 'payroll_run_not_closed', 'warning',
         'La planilla de remuneraciones del período no está cerrada: el costo de personal quedaría como estimación (sueldo/30 × factor) en vez del real.',
         1::bigint, NULL::numeric
   WHERE NOT EXISTS (
     SELECT 1 FROM public.payroll_runs pr
      WHERE pr.tenant_id = v_tenant
        AND pr.period_month = v_from
        AND pr.status IN ('cerrada', 'pagada'))
     -- Solo avisa si hubo actividad de personal en el mes: un mes sin asistencia
     -- no necesita planilla y el aviso sería ruido.
     AND EXISTS (
       SELECT 1 FROM public.finance_entries fe
        WHERE fe.tenant_id = v_tenant
          AND fe.source_type = 'labor_day'
          AND fe.entry_date BETWEEN v_from AND v_to);
END;
$$;
GRANT EXECUTE ON FUNCTION public.finance_period_precheck(date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
