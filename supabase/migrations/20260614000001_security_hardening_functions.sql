-- =============================================================================
-- Endurecimiento de funciones (linter de Supabase)
--
-- Resuelve dos familias de advertencias SOLO en lo que es seguro hacer:
--
--   1. function_search_path_mutable (0011): fija un search_path explícito en
--      todas las funciones SECURITY DEFINER. Evita que el rol que invoca pueda
--      manipular el search_path. No cambia el comportamiento: estas funciones ya
--      asumían el esquema `public`.
--
--   2. anon/authenticated_security_definer_function_executable (0028/0029):
--      revoca EXECUTE de las funciones de TRIGGER, que nunca deberían ser
--      llamables como RPC público. Los triggers corren con privilegios del
--      dueño, así que revocar EXECUTE NO los afecta.
--
-- NO se tocan los helpers de RLS (get_my_tenant_id, is_super_admin, get_my_role,
-- is_tenant_admin) ni las RPC de la app (use_qr_token, next_internal_code,
-- check_rate_limit): revocar su EXECUTE podría romper el RLS o flujos de la app.
-- Se evalúan aparte. Para anon esos helpers son inofensivos (devuelven null/false).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================================

-- ── 1. search_path fijo (seguro, no cambia comportamiento) ────────────────────
ALTER FUNCTION public.get_my_tenant_id()                       SET search_path = public, extensions;
ALTER FUNCTION public.is_super_admin()                         SET search_path = public, extensions;
ALTER FUNCTION public.get_my_role()                            SET search_path = public, extensions;
ALTER FUNCTION public.is_tenant_admin()                        SET search_path = public, extensions;
ALTER FUNCTION public.prevent_profile_privilege_escalation()   SET search_path = public, extensions;
ALTER FUNCTION public.handle_new_user()                        SET search_path = public, extensions;
ALTER FUNCTION public.seed_default_categories()                SET search_path = public, extensions;
ALTER FUNCTION public.next_internal_code(uuid, text)           SET search_path = public, extensions;
ALTER FUNCTION public.use_qr_token(text, uuid, uuid)           SET search_path = public, extensions;
ALTER FUNCTION public.check_rate_limit(text, integer, integer) SET search_path = public, extensions;

-- ── 2. Quitar EXECUTE público a las funciones de TRIGGER ──────────────────────
-- (no necesitan ser RPC; los triggers las invocan con privilegios del dueño)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privilege_escalation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_default_categories()              FROM PUBLIC, anon, authenticated;
