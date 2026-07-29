-- =============================================================================
-- Fix F4.2 — el reverso perdía el vencimiento
--
-- Encontrado por el E2E de F4.2. `finance_reverse_source` se escribió en F0,
-- antes de que existiera `due_date`, así que emitía los reversos con esa
-- columna en NULL:
--
--    500.000 | 2026-08-18 | original
--   -500.000 | null       | REVERSO   ← no netea con el original
--
-- Como `finance_cash_flow` agrupa por vencimiento (tiene que hacerlo: un
-- vencimiento es una fila del calendario), el reverso quedaba en un grupo
-- aparte y NINGUNO de los dos se apagaba. Efecto en producción: el flujo de
-- caja mostraría **pagos que ya no existen** —una factura pagada seguiría
-- proyectando salida— y además una obligación repactada aparecería dos veces,
-- inflando el total por pagar.
--
-- El neto global siempre estuvo bien; el error era de AGRUPACIÓN, que es
-- justamente de lo que vive un flujo de caja.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finance_reverse_source(
    p_source_type text,
    p_source_id   text,
    p_reason      text,
    p_tenant      uuid DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tenant uuid := CASE
      WHEN public.is_super_admin() AND p_tenant IS NOT NULL THEN p_tenant
      ELSE public.get_my_tenant_id()
  END;
  v_name   text;
  v_count  integer;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Sin tenant.';
  END IF;
  SELECT name INTO v_name FROM public.profiles WHERE id = auth.uid();

  WITH live AS (
    -- due_date entra al GROUP BY: dos obligaciones del mismo documento con
    -- vencimientos distintos (una repactación) son hechos distintos y cada una
    -- necesita su propio reverso, o el calendario queda descuadrado.
    SELECT nature, stage, category, contract_id, contract_name, tax_rate, due_date,
           counterparty_type, counterparty_id, counterparty_name,
           MAX(source_code) AS source_code,
           SUM(amount_net)  AS net,
           MIN(id::text)::uuid AS first_id
    FROM public.finance_entries
    WHERE tenant_id = v_tenant
      AND source_type = p_source_type
      AND source_id   = p_source_id
    GROUP BY nature, stage, category, contract_id, contract_name, tax_rate, due_date,
             counterparty_type, counterparty_id, counterparty_name
    HAVING SUM(amount_net) <> 0
  )
  INSERT INTO public.finance_entries (
    tenant_id, entry_date, due_date, nature, stage, category,
    amount_net, currency, amount_original, fx_rate, tax_rate,
    contract_id, contract_name, source_type, source_id, source_code,
    counterparty_type, counterparty_id, counterparty_name,
    reversal_of, notes, created_by, created_by_name
  )
  -- entry_date = CURRENT_DATE (la corrección ocurre hoy, y así nunca choca con
  -- un período cerrado — F4.1), pero due_date se COPIA del hecho original: es
  -- un atributo del hecho reversado, no de la corrección.
  SELECT v_tenant, CURRENT_DATE, due_date, nature, stage, category,
         -net, 'CLP', -net, 1, tax_rate,
         contract_id, contract_name, p_source_type, p_source_id, source_code,
         counterparty_type, counterparty_id, counterparty_name,
         first_id, p_reason, auth.uid(), v_name
  FROM live;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.finance_reverse_source(text, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.finance_reverse_source(text, text, text, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
