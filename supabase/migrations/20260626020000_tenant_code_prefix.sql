-- =============================================================================
-- Configuración de App: prefijo de correlativos por tenant (Opción A)
--
-- Hasta ahora el prefijo de los códigos internos era SIEMPRE las iniciales
-- derivadas del NOMBRE del tenant (p.ej. "Soy Pyme" → "SYPV-OCA-0001"), salvo
-- cuando se pasaba un prefijo semántico fijo en código (p.ej. "SOLPED").
--
-- Ahora cada tenant puede definir SU PROPIO prefijo base (columna code_prefix),
-- p.ej. "ACME" → "ACME-OCA-0001". Precedencia en next_internal_code:
--   1) p_prefix explícito (semántico del sistema, p.ej. 'SOLPED')   → se respeta
--   2) tenants.code_prefix (configurado por el tenant)              → se usa
--   3) iniciales derivadas del nombre (comportamiento histórico)    → fallback
--
-- El contador sigue siendo por (tenant, tipo), así cambiar el prefijo NO reinicia
-- la numeración ni choca con códigos ya emitidos: solo afecta los nuevos.
-- Aditivo + idempotente. Mantiene SECURITY DEFINER + search_path del hardening.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_prefix text;

CREATE OR REPLACE FUNCTION public.next_internal_code(
    p_tenant_id   uuid,
    p_entity_type text,            -- 'TX', 'RET', 'PRQ', 'ARR', 'ACT', 'MOV', 'OCA', etc.
    p_prefix      text DEFAULT NULL -- override semántico; NULL = code_prefix del tenant o iniciales
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_counter_id   text;
    v_next_seq     integer;
    v_tenant_name  text;
    v_tenant_pref  text;
    v_words        text[];
    v_prefix       text;
BEGIN
    IF p_prefix IS NOT NULL AND trim(p_prefix) <> '' THEN
        -- 1) Prefijo semántico fijo del sistema (p.ej. 'SOLPED').
        v_prefix := upper(trim(p_prefix));
    ELSE
        -- 2) Prefijo configurado por el tenant (Configuración de App).
        SELECT code_prefix, name
          INTO v_tenant_pref, v_tenant_name
          FROM public.tenants WHERE id = p_tenant_id;

        IF v_tenant_pref IS NOT NULL AND trim(v_tenant_pref) <> '' THEN
            v_prefix := upper(trim(v_tenant_pref));
        ELSE
            -- 3) Comportamiento histórico: iniciales del nombre (igual que TS getInitials()).
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
