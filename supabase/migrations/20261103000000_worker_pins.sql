-- ════════════════════════════════════════════════════════════════════════════
-- PIN personal del trabajador para aceptar una entrega identificada con carnet
--
-- POR QUÉ: escanear el carnet o digitar el RUT identifica la TARJETA, no a la
-- persona, y el trabajador no hace ningún acto de aceptación: cualquiera que
-- conozca un RUT puede generar un acuse a nombre de otro. El PIN es lo único que
-- sólo sabe el trabajador. Diseño: docs/research/EPP-FASE1-PIN-DISEÑO.md.
--
-- MARCHA BLANCA: queda APAGADO. `tenants.carnet_pin_required` nace en false y,
-- mientras esté así, la entrega por carnet funciona exactamente como hoy. El
-- código y la tabla quedan listos para encenderlo por empresa cuando se decida.
--
-- QUÉ SE GUARDA
--   · worker_pins: sólo el HASH (scrypt + sal + pepper de servidor), nunca el PIN.
--     RLS activa SIN policies y sin privilegios para authenticated/anon: nadie lo
--     lee desde el navegador, ni un administrador. Se escribe sólo desde las rutas
--     /api/pin/* con service role.
--   · Con 4 dígitos hay 10.000 combinaciones: lo que protege es el BLOQUEO
--     (5 fallos → 15 minutos). Los contadores se mueven en funciones atómicas,
--     para que dos intentos simultáneos no se salten el límite.
--   · biometric_verifications.outcome + 'id_document_pin' (carnet + PIN válido)
--   · material_requests.delivery_verification + 'pin' (cómo salió la entrega)
--
-- Los dos CHECK son de COLUMNA y Postgres los nombró solo: se buscan por
-- contenido y al final se comprueba que quedó uno solo.
-- Idempotente: seguro de re-ejecutar.
-- ════════════════════════════════════════════════════════════════════════════

-- ── El interruptor, por empresa ──────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS carnet_pin_required boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tenants.carnet_pin_required IS
  'Si es true, la entrega identificada con carnet exige el PIN personal del trabajador. Apagado = marcha blanca (carnet solo).';

-- ── Los PIN ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.worker_pins (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tenant_id       uuid,
  pin_hash        text NOT NULL,
  pin_salt        text NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  -- Quién estaba en el equipo cuando se creó (el PIN lo digita el trabajador).
  set_by          uuid,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    timestamptz,
  last_used_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_worker_pins_tenant ON public.worker_pins (tenant_id);

COMMENT ON TABLE public.worker_pins IS
  'PIN personal (sólo el hash) con que el trabajador acepta una entrega identificada con carnet. Sin acceso para authenticated: sólo service role desde /api/pin/*.';

ALTER TABLE public.worker_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_pins FROM authenticated;
REVOKE ALL ON public.worker_pins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.worker_pins TO service_role;
-- NO se agrega a la publicación de Realtime: sería otra puerta al mismo dato.

-- ── Contadores atómicos ──────────────────────────────────────────────────────
-- Constantes espejo de src/lib/pin.ts (PIN_MAX_ATTEMPTS = 5, PIN_LOCK_MINUTES = 15).
CREATE OR REPLACE FUNCTION public.pin_register_failure(p_user uuid)
RETURNS TABLE (failed_attempts integer, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.worker_pins w
     SET failed_attempts = CASE
           WHEN w.locked_until IS NOT NULL AND w.locked_until <= now() THEN 1
           ELSE w.failed_attempts + 1 END,
         locked_until = CASE
           WHEN (CASE WHEN w.locked_until IS NOT NULL AND w.locked_until <= now() THEN 1
                      ELSE w.failed_attempts + 1 END) >= 5
           THEN now() + interval '15 minutes'
           ELSE NULL END
   WHERE w.user_id = p_user
  RETURNING w.failed_attempts, w.locked_until;
END;
$$;

CREATE OR REPLACE FUNCTION public.pin_register_success(p_user uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE public.worker_pins
     SET failed_attempts = 0, locked_until = NULL, last_used_at = now()
   WHERE user_id = p_user;
$$;

REVOKE ALL ON FUNCTION public.pin_register_failure(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pin_register_failure(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.pin_register_failure(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pin_register_success(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pin_register_success(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.pin_register_success(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pin_register_failure(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.pin_register_success(uuid) TO service_role;

-- ── Vocabulario nuevo de la evidencia ────────────────────────────────────────
DO $$
DECLARE
  c record;
  n int;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.biometric_verifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%no_match%'
  LOOP
    EXECUTE format('ALTER TABLE public.biometric_verifications DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.biometric_verifications
    ADD CONSTRAINT biometric_outcome_check CHECK (
      outcome IN (
        'match', 'no_match', 'no_face', 'error', 'spoof_suspected', 'id_document', 'id_document_pin',
        'exception_requested', 'exception_granted', 'exception_denied'
      )
    );

  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.material_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%delivery_verification%'
  LOOP
    EXECUTE format('ALTER TABLE public.material_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE public.material_requests
    ADD CONSTRAINT material_requests_delivery_verification_check CHECK (
      delivery_verification IS NULL
      OR delivery_verification IN ('biometric', 'exception', 'rut', 'pin')
    );

  SELECT count(*) INTO n FROM pg_constraint
  WHERE conrelid = 'public.biometric_verifications'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%no_match%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Quedaron % restricciones sobre outcome; debía quedar una.', n;
  END IF;

  SELECT count(*) INTO n FROM pg_constraint
  WHERE conrelid = 'public.material_requests'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%delivery_verification%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Quedaron % restricciones sobre delivery_verification; debía quedar una.', n;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
