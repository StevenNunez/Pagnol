-- =============================================================================
-- QR Tokens dinámicos anti-fraude
--
-- Cada vez que un trabajador abre su credencial digital, el servidor genera
-- un token criptográfico aleatorio válido por 120 segundos. Al escanear,
-- la función use_qr_token() valida Y consume el token en una sola operación
-- atómica (UPDATE con RETURNING), evitando race conditions y reúso.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.qr_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tenant_id   uuid        NOT NULL,
    token       text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_tokens_token    ON public.qr_tokens (token);
CREATE INDEX        IF NOT EXISTS idx_qr_tokens_active   ON public.qr_tokens (user_id, expires_at) WHERE used_at IS NULL;

ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;

-- Miembros del mismo tenant pueden leer tokens (para validación cliente-side si se necesita)
CREATE POLICY "tenant members can read qr tokens" ON public.qr_tokens
    FOR SELECT USING (
        auth.uid() IS NOT NULL AND
        tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    );

-- =============================================================================
-- Función atómica: valida y consume el token en un solo UPDATE.
-- Retorna el user_id si el token era válido y no había sido usado; NULL si no.
-- SECURITY DEFINER: se ejecuta como el propietario (bypassa RLS para el UPDATE).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.use_qr_token(
    p_token     text,
    p_user_id   uuid,
    p_tenant_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    UPDATE public.qr_tokens
    SET    used_at = now()
    WHERE  token      = p_token
      AND  user_id    = p_user_id
      AND  tenant_id  = p_tenant_id
      AND  used_at    IS NULL
      AND  expires_at > now()
    RETURNING user_id INTO v_user_id;

    RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.use_qr_token(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.use_qr_token(text, uuid, uuid) TO service_role;
