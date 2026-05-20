-- =============================================================================
-- Función RPC atómica para generar códigos internos secuenciales
-- Reemplaza el patrón "SELECT COUNT(*) + 1" que tiene race conditions.
--
-- La operación INSERT ... ON CONFLICT DO UPDATE es atómica en PostgreSQL:
-- dos llamadas concurrentes siempre recibirán números distintos.
--
-- Uso:  SELECT next_internal_code('<tenant_uuid>', 'TX');
-- Ej:   → "PAG-TX-0042"
-- =============================================================================

-- 1. Tabla counters (si no existe)
CREATE TABLE IF NOT EXISTS public.counters (
    id            text        PRIMARY KEY,
    tenant_id     uuid        NOT NULL,
    entity_type   text        NOT NULL,
    last_sequence integer     NOT NULL DEFAULT 0,
    last_updated  timestamptz NOT NULL DEFAULT now()
);

-- 2. Función atómica
CREATE OR REPLACE FUNCTION public.next_internal_code(
    p_tenant_id   uuid,
    p_entity_type text   -- 'TX', 'RET', 'PRQ', 'PUR', 'ACT', 'MOV', etc.
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_counter_id  text;
    v_next_seq    integer;
    v_tenant_name text;
    v_words       text[];
    v_prefix      text;
BEGIN
    -- Construir prefijo igual que TS getInitials()
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

    -- Incremento atómico: una sola operación, sin race condition
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

-- 3. Permisos
GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_internal_code(uuid, text) TO service_role;

-- =============================================================================
-- 4. Seed: inicializar contadores con la cantidad de registros existentes
--    para que los próximos IDs no choquen con los ya existentes.
--    Es idempotente: ON CONFLICT garantiza que no baja un contador existente.
-- =============================================================================

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_TX', tenant_id::uuid, 'TX', COUNT(*)::integer, now()
FROM   public.material_requests
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_RET', tenant_id::uuid, 'RET', COUNT(*)::integer, now()
FROM   public.return_requests
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_PRQ', tenant_id::uuid, 'PRQ', COUNT(*)::integer, now()
FROM   public.purchase_requests
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_PUR', tenant_id::uuid, 'PUR', COUNT(*)::integer, now()
FROM   public.purchase_orders
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_ACT', tenant_id::uuid, 'ACT', COUNT(*)::integer, now()
FROM   public.materials
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

INSERT INTO public.counters (id, tenant_id, entity_type, last_sequence, last_updated)
SELECT tenant_id::text || '_MOV', tenant_id::uuid, 'MOV', COUNT(*)::integer, now()
FROM   public.stock_movements
GROUP  BY tenant_id
ON CONFLICT (id) DO UPDATE
    SET last_sequence = GREATEST(counters.last_sequence, EXCLUDED.last_sequence),
        last_updated  = now();

-- Migrar claves antiguas del bulk-upload (_materials → ya cubierto por _ACT arriba)
-- Las filas antiguas con id = '{uuid}_materials' pueden eliminarse si existen
DELETE FROM public.counters WHERE id LIKE '%_materials';
DELETE FROM public.counters WHERE id LIKE '%_movements';
