-- ═══════════════════════════════════════════════════════════════════════════
-- Detección de vida (*liveness*) en la evidencia biométrica
--
-- POR QUÉ:
-- Hasta hoy una fotografía en un celular pasa la verificación facial, y quien
-- más fácil puede explotarlo es el propio pañolero, que custodia el proceso y
-- tiene la cara del trabajador a mano (credencial QR, perfil, WhatsApp).
--
-- Se agrega un desafío de gesto —parpadear o abrir la boca, sorteado en el
-- momento— calculado sobre los 68 landmarks que el detector YA entrega. No
-- cambia la librería de reconocimiento a propósito: los templates enrolados son
-- los 128 floats de face-api, y migrar de motor los invalidaría todos.
--
-- PERO EL MOTIVO DE ESTA MIGRACIÓN ES OTRO, y es el importante:
-- `biometric_verifications` no tenía dónde decir que hubo sospecha de
-- suplantación. Un rechazo por foto habría tenido que escribirse como
-- `no_match` ("no eras tú") o `error`, y las dos MIENTEN sobre lo que pasó:
-- ante un reclamo, "era su cara, en papel" y "no era su cara" son hechos
-- distintos. Es el mismo defecto que ya se corrigió en la cláusula 4 del
-- contrato de responsabilidad, que afirmaba "firmado biométricamente de manera
-- irrefutable" incluso cuando no había habido biometría.
--
-- Append-only como todo lo demás: las filas anteriores quedan en NULL, y eso se
-- lee correctamente como "este hecho es anterior a liveness" — no como "aquí no
-- hubo gesto".
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Resultado del desafío ────────────────────────────────────────────────────
-- NULL = no se midió (hecho viejo, o etapa donde no se pide el gesto).
--   ok        → se observó el ciclo completo neutro → activo → neutro
--   no_face   → nunca hubo rostro que mirar. NO es sospecha: es encuadre.
--   no_change → hubo rostro toda la ventana y la razón jamás se movió.
--               Esto es lo que hace una fotografía.
--   timeout   → hubo movimiento pero el ciclo no se cerró. Se reintenta.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_outcome text;

-- Amplitud observada del gesto (máximo − mínimo de la razón durante la
-- ventana). Una foto se queda en el ruido del sensor; un parpadeo real la supera
-- con holgura. Se guarda SIEMPRE, incluso cuando no bloquea, porque es el dato
-- con el que se calibrará el umbral a partir de faenas reales en vez de a ojo.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_score numeric(6,4);

-- El umbral de amplitud VIGENTE ESE DÍA, por el mismo motivo por el que ya se
-- guarda `threshold`: si mañana se recalibra, una evidencia vieja sin él sería
-- ininterpretable ("0,03" no dice nada sin saber contra qué se comparó).
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_threshold numeric(6,4);

-- Qué gesto tocó en el sorteo ('blink' | 'mouth'). Que se sortee es lo que
-- impide el ataque siguiente al de la foto: un video pregrabado del trabajador
-- parpadeando no sirve si lo que se pidió fue abrir la boca.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_challenge text;

-- Cómo se midió. Versionado en el propio valor para que un cambio de método no
-- vuelva incomparables las filas viejas.
ALTER TABLE public.biometric_verifications
  ADD COLUMN IF NOT EXISTS liveness_method text;

-- ── Vocabulario de los valores nuevos ────────────────────────────────────────
ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_liveness_outcome_check;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_liveness_outcome_check CHECK (
    liveness_outcome IS NULL
    OR liveness_outcome IN ('ok', 'no_face', 'no_change', 'timeout')
  );

ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_liveness_challenge_check;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_liveness_challenge_check CHECK (
    liveness_challenge IS NULL OR liveness_challenge IN ('blink', 'mouth')
  );

-- ── `spoof_suspected` como resultado propio ──────────────────────────────────
-- Hace falta porque hoy el sistema mide pero NO bloquea (modo observación): un
-- rostro que coincide y no se mueve se registra como outcome='match' +
-- liveness_outcome='no_change', que es exactamente lo que ocurrió. Cuando el
-- bloqueo se active, el rechazo tendrá que poder decir su propio nombre, y sin
-- este valor volvería a disfrazarse de `no_match`.
--
-- El CHECK original es de COLUMNA, así que Postgres lo nombró solo y el nombre
-- exacto no está escrito en ninguna parte. Confiar en adivinarlo
-- (`biometric_verifications_outcome_check`) es peligroso: si no acierta, el
-- `DROP IF EXISTS` no hace nada EN SILENCIO, la restricción vieja sobrevive y
-- sigue rechazando `spoof_suspected` — y eso no se notaría hasta que el bloqueo
-- se active, meses después.
--
-- Así que se busca por su contenido. 'no_match' aparece ÚNICAMENTE en el
-- vocabulario de `outcome`: las otras dos restricciones de la tabla
-- (`biometric_exception_needs_reason`, `biometric_resolution_needs_author`)
-- nombran valores de excepción, nunca ése.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.biometric_verifications'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%no_match%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.biometric_verifications DROP CONSTRAINT %I', c.conname
    );
    RAISE NOTICE 'Vocabulario de outcome reemplazado: se quitó %', c.conname;
  END LOOP;
END $$;

ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_outcome_check CHECK (
    outcome IN (
      'match', 'no_match', 'no_face', 'error', 'spoof_suspected',
      'exception_requested', 'exception_granted', 'exception_denied'
    )
  );

-- Y se comprueba que quedó UNA sola y que admite el valor nuevo. Una migración
-- que se da por buena sin verificar su propio efecto es exactamente el drift de
-- esquema que ya mordió siete veces.
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint
  WHERE conrelid = 'public.biometric_verifications'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%no_match%'
    AND pg_get_constraintdef(oid) NOT LIKE '%spoof_suspected%';

  IF n > 0 THEN
    RAISE EXCEPTION
      'Quedaron % restricciones de outcome sin spoof_suspected: el bloqueo de liveness no podría registrarse.', n;
  END IF;
END $$;

-- ── Guardas de integridad ────────────────────────────────────────────────────
-- Un rechazo por suplantación tiene que venir respaldado por la medición que lo
-- motivó. Sin esto, `spoof_suspected` podría escribirse a mano sin evidencia
-- alguna, que es justo lo contrario de para qué existe la tabla.
-- (Con liveness_outcome NULL el segundo término es falso, así que la fila se
--  rechaza de verdad: no es un CHECK que se evalúa a NULL y deja pasar todo.)
ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_spoof_needs_measurement;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_spoof_needs_measurement CHECK (
    outcome <> 'spoof_suspected'
    OR (liveness_outcome IS NOT NULL AND liveness_outcome <> 'ok')
  );

-- Una medición sin su umbral ni su método es ilegible dentro de un año.
ALTER TABLE public.biometric_verifications
  DROP CONSTRAINT IF EXISTS biometric_liveness_needs_context;
ALTER TABLE public.biometric_verifications
  ADD CONSTRAINT biometric_liveness_needs_context CHECK (
    liveness_outcome IS NULL
    OR (liveness_threshold IS NOT NULL AND liveness_method IS NOT NULL)
  );

-- ── Para poder mirar el patrón después ───────────────────────────────────────
-- La pregunta que se va a hacer con esto no es "¿qué pasó en esta entrega?" sino
-- "¿hay un pañolero cuyos cierres nunca se mueven?". Índice parcial: sólo las
-- filas que sí midieron.
CREATE INDEX IF NOT EXISTS idx_biometric_verifications_liveness
  ON public.biometric_verifications (tenant_id, liveness_outcome, created_at DESC)
  WHERE liveness_outcome IS NOT NULL;
