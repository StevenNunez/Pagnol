-- =============================================================================
-- Corrección: recrea qr_tokens con tipos correctos.
-- La primera migración falló a mitad (error text vs uuid en la policy),
-- dejando la tabla con tenant_id TEXT. Esta migración la elimina y
-- la recrea correctamente. Los tokens son efímeros (2 min) → sin pérdida de datos.
-- =============================================================================

-- 1. Limpiar completamente
DROP TABLE IF EXISTS public.qr_tokens CASCADE;
DROP FUNCTION IF EXISTS public.use_qr_token(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.use_qr_token(text, uuid, text);

-- 2. Tabla con tipos correctos
CREATE TABLE public.qr_tokens (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tenant_id   uuid        NOT NULL,
    token       text        NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_qr_tokens_token  ON public.qr_tokens (token);
CREATE INDEX        idx_qr_tokens_active ON public.qr_tokens (user_id, expires_at) WHERE used_at IS NULL;

ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can read qr tokens" ON public.qr_tokens
    FOR SELECT USING (
        auth.uid() IS NOT NULL AND
        tenant_id IN (SELECT tenant_id FROM public.profiles WHERE id = auth.uid())
    );

-- 3. Función atómica: valida Y consume el token en un solo UPDATE
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
