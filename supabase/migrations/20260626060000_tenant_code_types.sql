-- =============================================================================
-- Configuración de App: override de la ETIQUETA DE TIPO por documento
--
-- Extiende 20260626050000 (prefijo por documento) permitiendo además sobrescribir
-- el segmento TIPO del correlativo. El código es {PREFIJO}-{TIPO}-{NÚMERO}
-- (p.ej. ACME-PUR-0001). Ahora el tenant puede mostrar, p.ej., "OC" en vez de
-- "PUR" → ACME-OC-0001, o "SOLPED" en vez de "ARR" → SOLPED-SOLPED-... (lo que elija).
--
-- CLAVE: el contador SIGUE indexado por la clave interna estable (p_entity_type),
-- NO por la etiqueta visible. Cambiar la etiqueta NO reinicia la numeración. El
-- override de tipo se guarda en tenants.code_types (jsonb { "PUR": "OC", ... }).
--
-- Resolución del PREFIJO (sin cambios respecto a 050000):
--   1) code_prefixes ->> tipo  (override por documento)            → gana
--   2) p_prefix explícito       (default semántico, p.ej. 'SOLPED') → si no hay override
--   3) tenants.code_prefix      (prefijo base de la empresa)        → fallback
--   4) iniciales del nombre                                         → último recurso
-- Resolución de la ETIQUETA DE TIPO (nuevo):
--   code_types ->> tipo  (override)  →  si vacío, la clave interna (p_entity_type)
--
-- Superset idempotente: incluye los ADD COLUMN IF NOT EXISTS de 050000 para que
-- aplicar SOLO esta migración deje el esquema final completo. Mantiene
-- SECURITY DEFINER + search_path del hardening.
-- =============================================================================

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_prefix   text;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_prefixes jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS code_types    jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.next_internal_code(
    p_tenant_id   uuid,
    p_entity_type text,            -- clave interna ESTABLE del contador: 'TX','PUR','ARR',...
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
    v_type_pref    text;   -- override de prefijo por tipo
    v_type_label   text;   -- override de etiqueta de tipo (segmento visible)
    v_words        text[];
    v_prefix       text;
BEGIN
    -- Una sola lectura del tenant: overrides de prefijo + etiqueta + base + nombre.
    SELECT COALESCE(code_prefixes, '{}'::jsonb) ->> p_entity_type,
           COALESCE(code_types,    '{}'::jsonb) ->> p_entity_type,
           code_prefix,
           name
      INTO v_type_pref, v_type_label, v_tenant_pref, v_tenant_name
      FROM public.tenants
     WHERE id = p_tenant_id;

    -- ── PREFIJO ──────────────────────────────────────────────────────────────
    IF v_type_pref IS NOT NULL AND trim(v_type_pref) <> '' THEN
        v_prefix := upper(trim(v_type_pref));                 -- 1) override por documento
    ELSIF p_prefix IS NOT NULL AND trim(p_prefix) <> '' THEN
        v_prefix := upper(trim(p_prefix));                    -- 2) semántico del sistema
    ELSIF v_tenant_pref IS NOT NULL AND trim(v_tenant_pref) <> '' THEN
        v_prefix := upper(trim(v_tenant_pref));               -- 3) prefijo base
    ELSE
        -- 4) iniciales del nombre (igual que TS getInitials()).
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

    -- ── ETIQUETA DE TIPO (segmento visible; NO afecta el contador) ────────────
    IF v_type_label IS NULL OR trim(v_type_label) = '' THEN
        v_type_label := p_entity_type;                        -- sin override → clave interna
    ELSE
        v_type_label := upper(trim(v_type_label));
    END IF;

    -- ── CONTADOR atómico por (tenant, clave interna) — NO depende de etiquetas ─
    v_counter_id := p_tenant_id::text || '_' || p_entity_type;

    INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
    VALUES (v_counter_id, p_tenant_id, p_entity_type, 1, now())
    ON CONFLICT (id) DO UPDATE
        SET last_sequence = counters.last_sequence + 1,
            last_updated  = now()
    RETURNING last_sequence INTO v_next_seq;

    RETURN v_prefix || '-' || v_type_label || '-' || LPAD(v_next_seq::text, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO service_role;

-- Refresca el cache de esquema de PostgREST (para que la Data API vea code_types).
NOTIFY pgrst, 'reload schema';
