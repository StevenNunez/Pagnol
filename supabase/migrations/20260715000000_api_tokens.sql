-- =============================================================================
-- Tokens de API para MCP externo (Pagnol AI)
--
-- Permite a un usuario generar un token personal para conectar clientes MCP
-- externos (Claude Desktop, Claude Code, etc.) a los datos de su tenant a
-- través de /api/mcp. El token da acceso a las MISMAS herramientas y el MISMO
-- gate de permisos que el asistente interno (src/ai/tools/definitions.ts) —
-- nunca bypasea RLS/permisos, solo cambia el transporte de autenticación
-- (Bearer token propio en vez de sesión Supabase, ya que un cliente MCP
-- externo no tiene sesión).
--
-- El token en texto plano NUNCA se persiste: se genera en el navegador, se
-- hashea (SHA-256) y solo el hash viaja al INSERT. Se muestra al usuario UNA
-- sola vez al crearlo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_tokens (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    owner_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name          text NOT NULL,
    token_hash    text NOT NULL UNIQUE,
    token_prefix  text NOT NULL, -- primeros caracteres, solo para reconocer el token en la lista (no reversible a texto completo)
    last_used_at  timestamptz,
    revoked_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON public.api_tokens(token_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_api_tokens_tenant ON public.api_tokens(tenant_id);

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- El dueño ve/gestiona sus propios tokens; el admin del tenant ve todos (para poder revocar los de un ex-empleado).
DROP POLICY IF EXISTS "api_tokens_select" ON public.api_tokens;
CREATE POLICY "api_tokens_select" ON public.api_tokens FOR SELECT TO authenticated
USING (public.is_super_admin() OR owner_id = auth.uid() OR (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin()));

DROP POLICY IF EXISTS "api_tokens_insert" ON public.api_tokens;
CREATE POLICY "api_tokens_insert" ON public.api_tokens FOR INSERT TO authenticated
WITH CHECK (owner_id = auth.uid() AND tenant_id = public.get_my_tenant_id());

-- Solo UPDATE de revoked_at (revocar); el dueño o un admin del tenant.
DROP POLICY IF EXISTS "api_tokens_update" ON public.api_tokens;
CREATE POLICY "api_tokens_update" ON public.api_tokens FOR UPDATE TO authenticated
USING (public.is_super_admin() OR owner_id = auth.uid() OR (tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin()));

GRANT SELECT, INSERT, UPDATE ON public.api_tokens TO authenticated;

NOTIFY pgrst, 'reload schema';
