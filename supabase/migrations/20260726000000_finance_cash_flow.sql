-- =============================================================================
-- Dominio Financiero F4.2 — Flujo de caja proyectado (RFC-002-F4-Plan)
--
-- El ledger respondía "¿cuánto costó?" y "¿cuánto gané?". Le falta la pregunta
-- que sigue: "¿me alcanza la plata, y cuándo?".
--
-- Hallazgo que cambió el diseño respecto del RFC: una factura pendiente NO es un
-- costo nuevo —la recepción ya devengó ese costo— sino una OBLIGACIÓN DE CAJA.
-- Meterla como costo duplicaría el margen; dejarla fuera del ledger obligaría a
-- leer documentos (lo que D2 descartó). El ledger ya distinguía dimensiones con
-- `nature`, así que la obligación entra como una naturaleza propia.
--
-- Decisión de Steven (2026-07-28): nature 'payable' / 'receivable'.
--
-- CONVENCIÓN DE MONTO — distinta a la de costo, y a propósito:
--   · cost/income  → NETO (sin IVA): mide resultado.
--   · payable/receivable → BRUTO (lo que realmente sale o entra del banco):
--     mide caja. `tax_rate` queda informativo.
-- Confundirlas es el error más fácil de cometer acá.
--
-- CICLO DE VIDA: la obligación nace con stage='accrued' y se apaga por REVERSO
-- (mismo patrón que todo el dominio — Art. 2), nunca por UPDATE. Neto vivo de
-- payable = lo que falta pagar de verdad.
-- =============================================================================

-- ── 1. Vencimiento del hecho ─────────────────────────────────────────────────
-- Solo lo llenan los emisores que lo conocen AL EMITIR (factura, cuota de
-- arriendo). Los hechos de costo suelen nacer sin vencimiento y quedan en NULL:
-- no entran al flujo, y está bien — el flujo proyecta caja, no costo.
ALTER TABLE public.finance_entries ADD COLUMN IF NOT EXISTS due_date date;

CREATE INDEX IF NOT EXISTS idx_finance_entries_due
    ON public.finance_entries (tenant_id, due_date)
    WHERE due_date IS NOT NULL;

-- ── 2. Naturalezas de caja ───────────────────────────────────────────────────
-- Los paneles de costo/margen filtran por nature explícitamente (se corrigió el
-- `else` genérico del panel principal en este mismo lote): payable/receivable
-- NO contaminan el resultado.
ALTER TABLE public.finance_entries DROP CONSTRAINT IF EXISTS finance_entries_nature_check;
ALTER TABLE public.finance_entries ADD CONSTRAINT finance_entries_nature_check
    CHECK (nature IN ('cost', 'income', 'payable', 'receivable'));

-- ── 3. Flujo de caja proyectado ──────────────────────────────────────────────
-- Agrupa las obligaciones VIVAS (neto ≠ 0 tras reversos) por vencimiento.
-- SECURITY INVOKER: hereda el RLS de finance_entries.
--
-- `bucket` = primer día de la semana (lunes) del vencimiento: el flujo se lee
-- por semanas, que es como se decide un pago. La UI agrupa a mes si hace falta.
CREATE OR REPLACE FUNCTION public.finance_cash_flow(
    p_from   date,
    p_to     date,
    p_tenant uuid DEFAULT NULL
) RETURNS TABLE (
    bucket        date,      -- lunes de la semana de vencimiento (NULL = sin fecha)
    nature        text,      -- 'payable' | 'receivable'
    contract_id   uuid,
    contract_name text,
    counterparty_name text,
    source_type   text,
    source_id     text,
    source_code   text,
    due_date      date,
    amount        numeric,   -- BRUTO vivo (tras reversos)
    overdue       boolean    -- vencido y aún vivo
)
LANGUAGE sql STABLE
SET search_path = public, extensions
AS $$
  SELECT
    CASE WHEN fe.due_date IS NULL THEN NULL
         ELSE (date_trunc('week', fe.due_date))::date END       AS bucket,
    fe.nature,
    fe.contract_id,
    COALESCE(MAX(c.name), MAX(fe.contract_name))                AS contract_name,
    MAX(fe.counterparty_name)                                   AS counterparty_name,
    fe.source_type,
    fe.source_id,
    MAX(fe.source_code)                                         AS source_code,
    fe.due_date,
    SUM(fe.amount_net)                                          AS amount,
    (fe.due_date IS NOT NULL AND fe.due_date < CURRENT_DATE)    AS overdue
  FROM public.finance_entries fe
  LEFT JOIN public.contracts c ON c.id = fe.contract_id
  WHERE fe.tenant_id = COALESCE(p_tenant, public.get_my_tenant_id())
    AND fe.nature IN ('payable', 'receivable')
    -- Sin vencimiento entra igual (se muestra aparte): una deuda sin fecha
    -- sigue siendo deuda, y ocultarla daría un flujo optimista.
    AND (fe.due_date IS NULL OR fe.due_date BETWEEN p_from AND p_to)
  GROUP BY fe.nature, fe.contract_id, fe.source_type, fe.source_id, fe.due_date
  -- Obligación ya pagada o anulada = neto 0 por el reverso: no es flujo futuro.
  HAVING SUM(fe.amount_net) <> 0;
$$;
GRANT EXECUTE ON FUNCTION public.finance_cash_flow(date, date, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
