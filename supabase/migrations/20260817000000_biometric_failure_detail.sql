-- ═══════════════════════════════════════════════════════════════════════════
-- Que la evidencia biométrica diga POR QUÉ falló
--
-- POR QUÉ:
-- `outcome = 'error'` es hoy un cajón donde caen CINCO causas distintas, que el
-- código ya sabe separar y muestra bien en pantalla, pero pierde al guardar:
--
--   · no hay elemento de cámara            → problema del equipo
--   · el servidor de match no respondió    → problema de red
--   · el trabajador no está enrolado       → NI SIQUIERA ES UN ERROR: es un
--                                            dato administrativo
--   · el descriptor no le sirvió al server → problema de captura
--   · una excepción cualquiera             → lo que quede
--
-- La prueba de que esto importa está en la propia tabla: las 7 filas de
-- `error` del 13-ago-2026 son indiagnosticables a posteriori. Se sabe que NO
-- fueron "no enrolado" (hay matches del mismo sujeto un segundo después) y que
-- NO fueron falta de rostro (eso se escribe `no_face`), y ahí se acaba lo que
-- se puede afirmar. Reconstruir a mano lo que el código ya sabía en el momento
-- es el mismo defecto que se corrigió en `no_face` vs `no_match` y en el
-- diagnóstico del 1:N, donde cuatro problemas distintos llegaban a la pantalla
-- como la misma animación girando.
--
-- Y de paso, la instrumentación que le falta al liveness: hoy se guarda la
-- amplitud del gesto pero NO cuántos frames vieron rostro. Sin eso, un
-- `timeout` no se puede distinguir entre "el umbral del gesto está alto" y "el
-- detector perdió la cara a mitad del gesto" — que son la misma fila en la
-- tabla y dos arreglos opuestos en el código. Ocurrió con el primer timeout
-- real (14-ago-2026: amplitud 0,4015 contra un mínimo de 0,08, o sea el gesto
-- se hizo y se rechazó igual).
--
-- Append-only como todo lo demás: las filas anteriores quedan en NULL y eso se
-- lee como "este hecho es anterior a la instrumentación", no como "aquí no
-- hubo motivo".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Motivo fino del fallo técnico ────────────────────────────────────────────
-- NULL = no aplica (el acto no falló, o es anterior a esta migración).
--   no_camera          → no había elemento de video con qué mirar
--   server_unreachable → /api/biometric/match no respondió
--   not_enrolled       → el sujeto no tiene template en la bóveda
--   bad_input          → el servidor rechazó el descriptor enviado
--   exception          → cualquier otro fallo, con su mensaje en el log
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS failure_detail text;

ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_failure_detail_check;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_failure_detail_check CHECK (
    failure_detail IS NULL
    OR failure_detail IN (
      'no_camera', 'server_unreachable', 'not_enrolled', 'bad_input', 'exception'
    )
  );

-- El detalle sólo tiene sentido acompañando a un `error`: pegárselo a un
-- `match` sería describir un fallo que no ocurrió.
--
-- ⚠️ Deliberadamente NO se exige lo contrario (que todo `error` traiga detalle).
-- Un CHECK así se validaría contra las filas YA EXISTENTES y abortaría la
-- migración entera por las 7 de agosto, que nacieron sin él. Las filas viejas
-- se quedan sin motivo — no hay de dónde sacárselo — y las nuevas sí lo traen
-- porque el código las escribe con él, no porque la base las obligue.
ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_failure_detail_needs_error;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_failure_detail_needs_error CHECK (
    failure_detail IS NULL OR outcome = 'error'
  );

-- ── Instrumentación del desafío de vida ──────────────────────────────────────
-- Frames en los que SÍ se detectó rostro durante la ventana del gesto.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_frames integer;

-- Frames en los que el detector PERDIÓ el rostro. Es la mitad que faltaba: la
-- máquina de estados reinicia el progreso del gesto cada vez que pierde la
-- cara, así que un `timeout` con muchos frames perdidos significa "el detector
-- no aguantó" y con cero significa "el umbral del gesto está mal calibrado".
-- Sin este número los dos casos son indistinguibles en la evidencia.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_frames_lost integer;

-- Cuánto duró de verdad la ventana. Un gesto rechazado en 800 ms no es lo
-- mismo que uno rechazado tras los 6 s completos.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_duration_ms integer;

-- Conteos y duraciones no pueden ser negativos. Es un CHECK barato que atrapa
-- un error de signo antes de que contamine la serie con la que se va a
-- calibrar el umbral.
ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_liveness_counts_nonneg;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_liveness_counts_nonneg CHECK (
    (liveness_frames IS NULL OR liveness_frames >= 0)
    AND (liveness_frames_lost IS NULL OR liveness_frames_lost >= 0)
    AND (liveness_duration_ms IS NULL OR liveness_duration_ms >= 0)
  );

-- ── Para poder mirar el patrón después ───────────────────────────────────────
-- La pregunta que se hará con esto es "¿qué está fallando en faena, y en qué
-- equipo?". Índice parcial: sólo las filas que fallaron por algo técnico.
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_failure
  ON public.biometric_verifications (tenant_id, failure_detail, created_at DESC)
  WHERE failure_detail IS NOT NULL;

-- ── La migración comprueba su propio efecto ──────────────────────────────────
-- Una migración que se da por buena sin verificar lo que hizo es exactamente el
-- drift de esquema que ya mordió siete veces en este proyecto.
DO $$
DECLARE
  faltan text;
BEGIN
  SELECT string_agg(c, ', ') INTO faltan
  FROM unnest(ARRAY[
    'failure_detail', 'liveness_frames', 'liveness_frames_lost', 'liveness_duration_ms'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'biometric_verifications'
      AND column_name = c
  );

  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'Faltaron columnas por crear: %', faltan;
  END IF;
END $$;

-- Y que el vocabulario nuevo efectivamente RECHAZA lo que no está en la lista.
-- Un CHECK mal escrito que evalúa a NULL no rechaza nada y se ve idéntico a uno
-- que funciona; la única forma de saberlo es intentar violarlo.
--
-- La sonda se arma con los identificadores de una fila REAL de la tabla, no con
-- UUIDs en cero: con valores inventados la fila moriría antes en una clave
-- foránea, la migración abortaría con un error que habla de otra cosa y el CHECK
-- se quedaría sin probar — un falso negativo disfrazado de fallo.
--
-- Si el CHECK funciona, el INSERT nunca llega a ocurrir y no queda rastro. Si NO
-- funciona, el INSERT entra y entonces se aborta la migración a propósito: eso
-- revierte la fila espuria (la tabla es append-only y no habría cómo borrarla
-- después) y deja el problema a la vista en vez de enterrado.
DO $$
DECLARE
  ref record;
  rechazado boolean := false;
BEGIN
  SELECT tenant_id, subject_user_id, operator_user_id
    INTO ref
    FROM public.biometric_verifications
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE NOTICE 'Tabla sin filas de referencia: sonda del CHECK omitida.';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.biometric_verifications
      (tenant_id, subject_user_id, subject_name, operator_user_id, operator_name,
       stage, outcome, failure_detail)
    VALUES
      (ref.tenant_id, ref.subject_user_id, 'sonda', ref.operator_user_id, 'sonda',
       'identificacion', 'error', 'motivo_inventado');
  EXCEPTION
    WHEN check_violation THEN
      rechazado := true;
  END;

  IF NOT rechazado THEN
    RAISE EXCEPTION
      'El CHECK de failure_detail NO rechaza valores fuera del vocabulario: la evidencia aceptaría motivos inventados.';
  END IF;

  RAISE NOTICE 'CHECK de failure_detail verificado: rechaza lo que no está en la lista.';
END $$;
