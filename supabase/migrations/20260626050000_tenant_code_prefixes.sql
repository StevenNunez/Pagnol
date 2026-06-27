-- =============================================================================
-- Configuración de App: prefijo de correlativos POR TIPO DE DOCUMENTO (Opción B)
--
-- Antes (Opción A) había un único prefijo base por tenant (tenants.code_prefix).
-- Ahora cada tenant puede además sobrescribir el prefijo de CADA tipo de documento
-- (Orden de Compra, Recepción, Solicitud de Arriendo, etc.) de forma individual,
-- guardado en tenants.code_prefixes (jsonb: { "PUR": "OC", "REC": "REC", ... }).
--
-- El código sigue con forma {PREFIJO}-{TIPO}-{NÚMERO} (p.ej. ACME-PUR-0001,
-- OC-PUR-0001). Solo cambia cómo se resuelve {PREFIJO}. Nueva precedencia:
--   1) code_prefixes ->> tipo  (override por documento, Configuración de App) → gana
--   2) p_prefix explícito       (default semántico del sistema, p.ej. 'SOLPED')  → si no hay override
--   3) tenants.code_prefix      (prefijo base de la empresa)                      → fallback
--   4) iniciales del nombre     (comportamiento histórico)                        → último recurso
--
-- El contador sigue por (tenant, tipo): cambiar un prefijo NO reinicia la
-- numeración ni choca con códigos ya emitidos. Solo afecta los nuevos.
--
-- Incluye `ADD COLUMN IF NOT EXISTS code_prefix` como red de seguridad: en este
-- proyecto la migración 20260626020000 podría no haberse aplicado del todo
-- (síntoma: el prefijo base "se guardaba" pero al recargar volvía vacío).
-- Aditivo + idempotente. Mantiene SECURITY DEFINER + search_path del hardening.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_prefix  text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_prefixes jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.next_internal_code(
    p_tenant_id   uuid,
    p_entity_type text,            -- 'TX', 'RET', 'PRQ', 'PUR', 'ARR', 'OCA', 'REC', 'ACT', etc.
    p_prefix      text DEFAULT NULL -- default semántico del sistema; NULL = override/base/iniciales
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
    v_tenant_pref  text;   -- prefijo base de la empresa
    v_type_pref    text;   -- override por tipo de documento
    v_words        text[];
    v_prefix       text;
BEGIN
    -- Una sola lectura del tenant: override por tipo + prefijo base + nombre.
    SELECT COALESCE(code_prefixes, '{}'::jsonb) ->> p_entity_type,
           code_prefix,
           name
      INTO v_type_pref, v_tenant_pref, v_tenant_name
      FROM public.tenants
     WHERE id = p_tenant_id;

    IF v_type_pref IS NOT NULL AND trim(v_type_pref) <> '' THEN
        -- 1) Override por documento (Configuración de App). Máxima prioridad.
        v_prefix := upper(trim(v_type_pref));
    ELSIF p_prefix IS NOT NULL AND trim(p_prefix) <> '' THEN
        -- 2) Prefijo semántico fijo del sistema (p.ej. 'SOLPED' para arriendos).
        v_prefix := upper(trim(p_prefix));
    ELSIF v_tenant_pref IS NOT NULL AND trim(v_tenant_pref) <> '' THEN
        -- 3) Prefijo base de la empresa.
        v_prefix := upper(trim(v_tenant_pref));
    ELSE
        -- 4) Comportamiento histórico: iniciales del nombre (igual que TS getInitials()).
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

-- Refresca el cache de esquema de PostgREST (para que la Data API vea code_prefixes).
NOTIFY pgrst, 'reload schema';
