-- ════════════════════════════════════════════════════════════════════════════
-- Identidad acreditada con el carnet (RUT)
--
-- Decisión del 2026-10-21: en el pañol, al entregar o recibir, la persona se valida
-- por BIOMETRÍA o por su CARNET (RUT escaneado). Si se validó con el carnet, ya no se
-- le piden los pasos biométricos. Para que eso quede respaldado como respaldaba
-- la biometría, se agregan dos valores de vocabulario:
--
--   biometric_verifications.outcome        + 'id_document'  (identidad acreditada con el carnet)
--   material_requests.delivery_verification + 'rut'          (cómo salió la entrega; lo imprime el acta)
--
-- Los dos CHECK son de COLUMNA y Postgres los nombró solo: se buscan por contenido
-- (adivinar el nombre dejaría el viejo vivo y rechazando el valor nuevo, en silencio),
-- y al final se comprueba que quedó uno solo y que admite el valor.
-- ════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c record;
  n int;
BEGIN
  -- outcome: 'no_match' sólo aparece en el vocabulario de outcome.
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
        'match', 'no_match', 'no_face', 'error', 'spoof_suspected', 'id_document',
        'exception_requested', 'exception_granted', 'exception_denied'
      )
    );

  -- delivery_verification: se reconoce por nombrar la columna.
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
      OR delivery_verification IN ('biometric', 'exception', 'rut')
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
