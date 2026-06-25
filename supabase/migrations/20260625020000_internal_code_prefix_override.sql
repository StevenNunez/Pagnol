-- =============================================================================
-- next_internal_code: prefijo opcional (override de las iniciales del tenant)
--
-- Hasta ahora el código era SIEMPRE {iniciales_tenant}-{tipo}-{NNNN}
-- (p.ej. "SYPV-ARR-0001"). Para las SOLICITUDES queremos un prefijo semántico
-- fijo "SOLPED" (SOLicitud de PEDido), quedando "SOLPED-ARR-0001".
--
-- Se agrega un 3er parámetro opcional p_prefix:
--   • NULL/''  → comportamiento histórico (iniciales del tenant). No rompe nada.
--   • 'SOLPED' → usa ese prefijo literal.
-- El contador sigue siendo por (tenant, tipo), así la numeración es continua
-- (no se reinicia) y los códigos nuevos no chocan con los existentes.
--
-- Idempotente. Mantiene SECURITY DEFINER + search_path del hardening.
-- =============================================================================

-- La firma cambia (2 → 3 args), así que se elimina la anterior. PostgREST resuelve
-- las llamadas de 2 argumentos contra la nueva función vía el DEFAULT.
DROP FUNCTION IF EXISTS public.next_internal_code(uuid, text);

CREATE OR REPLACE FUNCTION public.next_internal_code(
    p_tenant_id   uuid,
    p_entity_type text,            -- 'TX', 'RET', 'PRQ', 'ARR', 'ACT', 'MOV', etc.
    p_prefix      text DEFAULT NULL -- override del prefijo; NULL = iniciales del tenant
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_counter_id  text;
    v_next_seq    integer;
    v_tenant_name text;
    v_words       text[];
    v_prefix      text;
BEGIN
    IF p_prefix IS NOT NULL AND trim(p_prefix) <> '' THEN
        -- Prefijo semántico fijo (p.ej. 'SOLPED').
        v_prefix := upper(trim(p_prefix));
    ELSE
        -- Comportamiento histórico: iniciales del tenant (igual que TS getInitials()).
        SELECT name INTO v_tenant_name FROM public.tenants WHERE id = p_tenant_id;
        v_tenant_name := COALESCE(NULLIF(trim(v_tenant_name), ''), 'PAG');

        v_words := string_to_array(v_tenant_name, ' ');
        IF array_length(v_words, 1) = 1 THEN
            v_prefix := upper(left(v_words[1], 3));
        ELSE
            SELECT string_agg(upper(left(w, 1)), '' ORDER BY ordinality)
            INTO   v_prefix
            FROM   unnest(v_words) WITH ORDINALITY AS t(w, ordinality)
            WHERE  trim(w) <> '';
            v_prefix := left(v_prefix, 4);
        END IF;
        IF v_prefix IS NULL OR v_prefix = '' THEN v_prefix := 'PAG'; END IF;
    END IF;

    -- Incremento atómico: el contador es por (tenant, tipo), NO depende del prefijo.
    v_counter_id := p_tenant_id::text || '_' || p_entity_type;

    INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
    VALUES (v_counter_id, p_tenant_id, p_entity_type, 1, now())
    ON CONFLICT (id) DO UPDATE
        SET last_sequence = counters.last_sequence + 1,
            last_updated  = now()
    RETURNING last_sequence INTO v_next_seq;

    RETURN v_prefix || '-' || p_entity_type || '-' || LPAD(v_next_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO service_role;

-- ── Backfill: códigos de arriendo existentes → prefijo SOLPED ──────────────────
-- "SYPV-ARR-0001" → "SOLPED-ARR-0001" (conserva tipo y número).
UPDATE public.rental_requests
SET internal_code = regexp_replace(internal_code, '^.*-ARR-', 'SOLPED-ARR-')
WHERE internal_code LIKE '%-ARR-%'
  AND internal_code NOT LIKE 'SOLPED-%';
