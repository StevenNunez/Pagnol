/**
 * Detección de vida (*liveness*) — matemática pura, sin Supabase ni DOM.
 *
 * Existe separada por el mismo motivo que `biometricMath.ts` y `financeMath.ts`:
 * todo lo que rodea a este cálculo sólo se puede ejercitar con una cámara
 * física, así que si la lógica viviera dentro del componente su única prueba
 * posible sería "lo probamos una vez y funcionó". Ese es exactamente el agujero
 * por el que la hora extra estuvo 4× mal pasando 57 tests.
 *
 * ── Por qué un desafío de gesto y no un modelo antispoof ──────────────────────
 * El reconocimiento del sistema son los 128 floats de `face-api`. Cambiar de
 * librería para ganar un modelo antispoof invalidaría **todos los templates ya
 * enrolados** y obligaría a citar a cada trabajador de vuelta. Un desafío de
 * gesto se calcula sobre los 68 landmarks que el detector YA entrega en cada
 * verificación: cero bytes nuevos de descarga, cero re-enrolamiento.
 *
 * ── Por qué parpadeo y boca, y no "gira la cabeza" ────────────────────────────
 * Medido el 2026-08-11: el detector pierde el rostro con 10° de rotación. Pedir
 * un giro sería ordenar un gesto que el propio detector no puede seguir, y el
 * trabajador vería un rechazo por obedecer. Parpadeo y apertura de boca mantienen
 * la cara de frente, que es donde este detector funciona.
 */

/** Punto de los 68 landmarks de face-api. */
export interface Punto {
  x: number;
  y: number;
}

/** Gesto pedido al trabajador. Se elige al azar: ver `pickChallenge`. */
export type LivenessChallenge = 'blink' | 'mouth';

/**
 * Una muestra del muestreo. `landmarks: null` significa que en ese frame el
 * detector no encontró rostro — que NO es lo mismo que un rostro quieto, y por
 * eso se distingue en el resultado.
 */
export interface LivenessSample {
  landmarks: Punto[] | null;
  at: number;
}

/**
 * Por qué no se pudo dar por vivo al sujeto. La distinción es el valor entero de
 * este módulo:
 *   `no_face`   → nunca hubo cara que mirar. Se resuelve acercándose.
 *   `no_change` → hubo cara todo el rato y el gesto NUNCA se movió. Eso es una
 *                 foto: es la única salida que constituye sospecha real.
 *   `timeout`   → hubo movimiento pero el ciclo no se completó. Se reintenta.
 * Colapsarlas en un booleano volvería a acusar de impostor a quien sólo estaba
 * mal encuadrado, que es el defecto que ya se corrigió en `verifyIdentity`.
 */
export type LivenessReason = 'ok' | 'no_face' | 'no_change' | 'timeout';

export interface LivenessResult {
  passed: boolean;
  reason: LivenessReason;
  challenge: LivenessChallenge;
  /**
   * Amplitud observada del gesto (máximo − mínimo de la razón durante la
   * ventana). Es el número que se guarda como evidencia y el que permitirá
   * calibrar el umbral con datos de faena en vez de a ojo: una foto se queda en
   * el ruido del sensor (~0,00–0,02) y un parpadeo real supera 0,10.
   */
  score: number;
  /** Frames en los que SÍ hubo rostro. */
  frames: number;
  /** Frames en los que el detector perdió el rostro. */
  framesLost: number;
  durationMs: number;
}

// ── Índices de los 68 landmarks ──────────────────────────────────────────────
const OJO_DERECHO = [36, 37, 38, 39, 40, 41] as const;
const OJO_IZQUIERDO = [42, 43, 44, 45, 46, 47] as const;
// Boca INTERIOR (60-67). Se usa la interior y no la exterior (48-59) porque los
// labios se estiran al hablar sin que la boca llegue a abrirse.
const BOCA_INTERIOR = [60, 61, 62, 63, 64, 65, 66, 67] as const;

export const LANDMARK_COUNT = 68;

/**
 * Umbrales del gesto, con banda de histéresis entre el estado neutro y el
 * activo. La banda evita que el ruido de un landmark haga oscilar la máquina de
 * estados y dé por cumplido un ciclo que nunca ocurrió.
 *
 * Las razones son adimensionales (se dividen por el ancho del propio ojo o de la
 * propia boca), así que no dependen de la distancia a la cámara — que es
 * justamente lo que las hace utilizables con un trabajador a dos metros.
 */
export const LIVENESS_THRESHOLDS = {
  blink: { neutral: 0.22, active: 0.15 },
  mouth: { neutral: 0.20, active: 0.45 },
} as const;

/**
 * Amplitud mínima para considerar que hubo movimiento real. Por debajo de esto
 * se reporta `no_change`, que es la firma de una foto sostenida frente a la
 * cámara.
 */
export const LIVENESS_MIN_AMPLITUDE = 0.08;

/** Método registrado en la evidencia, para que el hecho diga cómo se midió. */
export const LIVENESS_METHOD = 'landmark-challenge-v1';

const distancia = (a: Punto, b: Punto): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * *Eye Aspect Ratio*: alto del ojo dividido por su ancho. Ojo abierto ≈ 0,25–0,35;
 * cerrado ≈ 0,10. Al ser una razón entre dos medidas del mismo ojo, es invariante
 * a la escala del rostro en el encuadre.
 */
export function eyeAspectRatio(landmarks: Punto[], ojo: readonly number[]): number {
  const [p0, p1, p2, p3, p4, p5] = ojo.map(i => landmarks[i]);
  const ancho = distancia(p0, p3);
  if (ancho === 0) return 0;
  return (distancia(p1, p5) + distancia(p2, p4)) / (2 * ancho);
}

/**
 * Promedio del EAR de ambos ojos. Se promedian a propósito: un parpadeo natural
 * es simétrico, y exigir los dos por separado rechazaría a quien tiene un ojo
 * parcialmente tapado por el casco.
 */
export function blinkRatio(landmarks: Punto[]): number {
  return (
    (eyeAspectRatio(landmarks, OJO_DERECHO) + eyeAspectRatio(landmarks, OJO_IZQUIERDO)) / 2
  );
}

/**
 * *Mouth Aspect Ratio* sobre la boca interior. Cerrada ≈ 0,00–0,10; abierta > 0,50.
 */
export function mouthRatio(landmarks: Punto[]): number {
  const [p60, p61, p62, p63, p64, p65, p66, p67] = BOCA_INTERIOR.map(i => landmarks[i]);
  const ancho = distancia(p60, p64);
  if (ancho === 0) return 0;
  return (distancia(p61, p67) + distancia(p62, p66) + distancia(p63, p65)) / (3 * ancho);
}

/** La razón que le corresponde al desafío pedido. */
export function challengeRatio(landmarks: Punto[], challenge: LivenessChallenge): number {
  return challenge === 'blink' ? blinkRatio(landmarks) : mouthRatio(landmarks);
}

/**
 * Elige el gesto al azar. Que sea al azar es lo que impide el ataque siguiente al
 * de la foto: un video pregrabado del trabajador parpadeando no sirve si lo que
 * se pide esta vez es abrir la boca.
 *
 * Recibe el aleatorio por parámetro para poder fijarlo en los tests.
 */
export function pickChallenge(rnd: number = Math.random()): LivenessChallenge {
  return rnd < 0.5 ? 'blink' : 'mouth';
}

/** Instrucción en pantalla. Vive acá para que el texto no se duplique. */
export const CHALLENGE_PROMPT: Record<LivenessChallenge, string> = {
  blink: 'Parpadea una vez, mirando a la cámara.',
  mouth: 'Abre y cierra la boca, mirando a la cámara.',
};

/**
 * Recorre la secuencia y decide si el gesto ocurrió.
 *
 * La regla: hay que observar el ciclo completo **NEUTRO → ACTIVO → NEUTRO** con
 * el rostro detectado de forma continua. Exigir el regreso al neutro es lo que
 * encarece el ataque de las dos fotos (una con los ojos abiertos y otra con los
 * ojos cerrados): ya no bastan dos, hacen falta tres en el orden correcto y
 * dentro de la misma ventana de segundos.
 *
 * Si el detector pierde el rostro, el progreso se reinicia en vez de fallar: el
 * trabajador pudo simplemente moverse, y cobrarle un fallo por eso es el mismo
 * error que acusarlo de impostor por estar mal encuadrado. Lo que no se reinicia
 * es la amplitud acumulada, porque describe la ventana entera.
 */
export function evaluateLivenessSequence(
  samples: LivenessSample[],
  challenge: LivenessChallenge,
): LivenessResult {
  const { neutral, active } = LIVENESS_THRESHOLDS[challenge];
  // `blink` baja al activarse (el ojo se cierra) y `mouth` sube (la boca se
  // abre), así que la comparación se orienta una sola vez acá en vez de
  // repartir condicionales por todo el recorrido.
  const esActivo = (r: number) => (challenge === 'blink' ? r <= active : r >= active);
  const esNeutro = (r: number) => (challenge === 'blink' ? r >= neutral : r <= neutral);

  let frames = 0;
  let framesLost = 0;
  let min = Infinity;
  let max = -Infinity;
  // NEUTRO visto → ACTIVO visto → ciclo cerrado al volver a NEUTRO.
  let vioNeutro = false;
  let vioActivo = false;
  let cicloCompleto = false;

  for (const sample of samples) {
    if (!sample.landmarks || sample.landmarks.length < LANDMARK_COUNT) {
      framesLost++;
      // Se pierde el hilo del gesto, no la ventana: hay que volver a partir
      // desde el estado neutro.
      vioNeutro = false;
      vioActivo = false;
      continue;
    }

    frames++;
    const r = challengeRatio(sample.landmarks, challenge);
    if (!Number.isFinite(r)) continue;
    if (r < min) min = r;
    if (r > max) max = r;

    if (cicloCompleto) continue;

    if (!vioNeutro) {
      if (esNeutro(r)) vioNeutro = true;
      // Arrancar ya en activo (entró con la boca abierta) no cuenta: sin el
      // neutro previo no hay transición que observar, sólo una postura.
      continue;
    }
    if (!vioActivo) {
      if (esActivo(r)) vioActivo = true;
      continue;
    }
    if (esNeutro(r)) cicloCompleto = true;
  }

  const durationMs =
    samples.length >= 2 ? samples[samples.length - 1].at - samples[0].at : 0;
  const score = frames > 0 && Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
  const base = { challenge, score, frames, framesLost, durationMs };

  // Nunca hubo cara que mirar. No es sospecha de nada: es encuadre.
  if (frames === 0) return { ...base, passed: false, reason: 'no_face' };

  if (cicloCompleto) return { ...base, passed: true, reason: 'ok' };

  // Hubo rostro durante toda la ventana y la razón no se movió. Esto es lo que
  // hace una fotografía, y es la única salida que vale como sospecha.
  if (score < LIVENESS_MIN_AMPLITUDE) {
    return { ...base, passed: false, reason: 'no_change' };
  }

  // Se movió, pero el ciclo no se cerró: se reintenta, no se acusa.
  return { ...base, passed: false, reason: 'timeout' };
}

/**
 * Mensaje para el trabajador. Se mantiene junto a la lógica porque el criterio
 * de qué se le dice a cada quien ES la decisión de este módulo: el único caso
 * que insinúa mala fe es `no_change`, y aun así el texto no acusa a nadie —
 * quien decide eso es el ADC mirando la evidencia, no la pantalla del pañol.
 */
export const LIVENESS_MESSAGE: Record<LivenessReason, string> = {
  ok: 'Prueba de vida superada.',
  no_face: 'No se detectó ningún rostro durante la prueba. Acércate a la cámara y mira de frente.',
  no_change: 'No se detectó movimiento del rostro. Repite el gesto mirando a la cámara.',
  timeout: 'No se alcanzó a completar el gesto. Inténtalo de nuevo.',
};
