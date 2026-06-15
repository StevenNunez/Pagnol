-- =============================================================================
-- S9 — Rate limiting respaldado por Postgres
--
-- Limita la frecuencia de endpoints públicos sensibles (reset-password, demo,
-- register, contacto) para frenar abuso/enumeración/spam. Estado compartido en
-- la BD → funciona en serverless (cada invocación ve el mismo contador).
--
-- La función es atómica (INSERT ... ON CONFLICT DO UPDATE con lock de fila):
-- llamadas concurrentes con la misma key se serializan sin condición de carrera.
--
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text        PRIMARY KEY,
  count        integer     NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

-- Sin acceso para anon/authenticated; solo la RPC (SECURITY DEFINER) la toca.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Devuelve TRUE si la petición está permitida; FALSE si superó el límite en la ventana.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        THEN 1
        ELSE public.rate_limits.count + 1
    END,
    window_start = CASE
      WHEN public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
        THEN now()
        ELSE public.rate_limits.window_start
    END
  RETURNING count INTO v_count;

  RETURN v_count <= p_max;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;

-- Limpieza opcional de filas viejas (ejecutar manualmente o via cron):
--   DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
