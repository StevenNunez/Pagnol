-- =============================================================================
-- Endurecimiento por linter de Supabase (lote 2026-07-12)
--
-- Resuelve las advertencias del Security Advisor que SÍ son seguras de aplicar,
-- verificadas contra el código real (quién llama cada RPC / cómo se accede a
-- cada bucket):
--
--   1. function_search_path_mutable (0011): fija search_path en los 4 triggers
--      `set_*_updated_at` creados después del hardening 20260614000001
--      (work-reports, RFQ, recepción, cost centers) y les revoca EXECUTE
--      público (los triggers corren con privilegios del dueño; no les afecta).
--
--   2. anon/authenticated_security_definer_function_executable (0028/0029):
--      • check_rate_limit: SOLO la llama el servidor con service role
--        (src/modules/core/lib/rate-limit.ts → getSupabaseAdmin). Se revoca
--        anon+authenticated. Cierra un DoS selectivo real: cualquiera podía
--        quemar la cuota de otra IP vía /rest/v1/rpc/check_rate_limit.
--      • next_internal_code: la llama el navegador autenticado
--        (sequence-utils.ts). Se revoca anon y se AGREGA guard de tenant:
--        un usuario del tenant A ya no puede quemar correlativos del tenant B.
--      • use_qr_token: la llama el navegador autenticado
--        (attendanceMutations.ts). Se revoca anon.
--      • Los helpers de RLS (get_my_tenant_id, is_super_admin, get_my_role,
--        is_tenant_admin) NO SE TOCAN — las policies los evalúan con el rol
--        del que consulta, y el login por RUT consulta profiles como anon
--        (AuthProvider.login); revocar anon rompería ese login. Advertencia
--        del linter ACEPTADA a propósito (para anon devuelven null/false).
--
--   3. public_bucket_allows_listing (0025): elimina las policies SELECT
--      amplias de los buckets públicos `contracts`, `asset-photos` y
--      `tenant-logos`. La app solo usa upload()/getPublicUrl()/remove()
--      (verificado: cero .list() y cero .download() en src/), y en buckets
--      públicos la URL pública NO pasa por RLS → eliminar la policy solo
--      corta el listado cross-tenant vía API, que es lo que expone PII
--      (contratos EA / de responsabilidad firmados en `contracts`).
--      Nota: `contracts_read` se creó a mano en el dashboard (no existía en
--      ninguna migración); este DROP la deja por fin versionada.
--
--   NO incluye (no es SQL): activar "leaked password protection" — toggle en
--   Dashboard → Authentication → Sign In / Providers → Password.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. Triggers updated_at: search_path fijo + sin EXECUTE público ────────────
ALTER FUNCTION public.set_work_reports_updated_at()   SET search_path = public, extensions;
ALTER FUNCTION public.set_quote_requests_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_goods_receipts_updated_at() SET search_path = public, extensions;
ALTER FUNCTION public.set_cost_centers_updated_at()   SET search_path = public, extensions;

REVOKE EXECUTE ON FUNCTION public.set_work_reports_updated_at()   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_quote_requests_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_goods_receipts_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_cost_centers_updated_at()   FROM PUBLIC, anon, authenticated;

-- ── 2a. check_rate_limit: solo service role ───────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- ── 2b. next_internal_code: guard de tenant + sin anon ────────────────────────
-- Cuerpo idéntico al vigente (20260626060000: overrides de prefijo/etiqueta por
-- tenant) + guard al inicio. El guard permite: super-admin (opera cross-tenant
-- con el tenant switcheado), usuarios normales SOLO su propio tenant, y
-- service_role (por si un script/route server-side lo usa a futuro).
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
    -- Guard multi-tenant: solo el propio tenant (o super-admin / service role).
    IF NOT (
        (SELECT auth.role()) = 'service_role'
        OR public.is_super_admin()
        OR p_tenant_id = public.get_my_tenant_id()
    ) THEN
        RAISE EXCEPTION 'next_internal_code: tenant no autorizado';
    END IF;

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

REVOKE EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.next_internal_code(uuid, text, text) TO service_role;

-- ── 2c. use_qr_token: sin anon (la llama el dashboard autenticado) ────────────
REVOKE EXECUTE ON FUNCTION public.use_qr_token(text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.use_qr_token(text, uuid, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.use_qr_token(text, uuid, uuid) TO service_role;

-- ── 3. Buckets públicos: sin listado vía API ──────────────────────────────────
-- La URL pública (getPublicUrl) NO pasa por RLS en buckets públicos; estas
-- policies solo habilitaban listar/leer vía API REST de storage, que la app
-- no usa. INSERT/UPDATE/DELETE (acotadas a la carpeta del tenant) no se tocan.
DROP POLICY IF EXISTS "contracts_read"      ON storage.objects;
DROP POLICY IF EXISTS "asset_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "tenant_logos_select" ON storage.objects;

-- Refresca el cache de esquema de PostgREST.
NOTIFY pgrst, 'reload schema';
