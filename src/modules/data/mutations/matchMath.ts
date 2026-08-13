/**
 * Comparación de descriptores faciales — matemática pura, sin Supabase, sin DOM
 * y sin `face-api`.
 *
 * Existe separada por el mismo motivo que `livenessMath.ts` y `biometricMath.ts`,
 * más uno propio: desde el cierre de la bóveda biométrica (migración
 * `20260816000000`) esta comparación ya **no ocurre en el navegador**. El
 * descriptor enrolado no sale del servidor: el navegador extrae con `face-api`
 * los 128 floats de quien está frente a la cámara, los manda a
 * `/api/biometric/match`, y ahí se resuelve contra la bóveda. Que la matemática
 * viva aparte permite probarla sin cámara, sin red y sin base de datos.
 *
 * Lo que se gana además de la privacidad: el umbral pasa a ser del servidor. Antes
 * vivía en un `const` del bundle, donde cualquiera con las devtools abiertas podía
 * decidir a qué distancia aceptaba una cara.
 */

/**
 * Umbral de coincidencia (distancia euclidiana; menor = más parecido).
 *
 * ⚠️ Medido el 2026-08-11 contra datos reales: entre personas distintas la
 * distancia dio 0,72–0,73, pero entre dos capturas de la MISMA persona dio 0,427
 * — o sea que este 0,5 deja apenas un 15% de margen antes de rechazar a quien sí
 * corresponde. Está apretado por el lado equivocado. No moverlo a ojo: hay que
 * medir el inter-persona con capturas de la cámara real, no con fotos.
 *
 * Cada verificación guarda el umbral con el que se resolvió, justamente para que
 * recalibrarlo no vuelva ilegible la evidencia vieja.
 */
export const MATCH_THRESHOLD = 0.5;

/**
 * Separación mínima entre el mejor candidato y el segundo mejor en una búsqueda
 * 1:N. Por debajo de esto los dos son indistinguibles dentro del ruido del
 * sensor y elegir al mejor es literalmente lanzar una moneda — sobre quién queda
 * como responsable de un activo.
 *
 * 📏 **Razonado, no medido** (mismo estatus que `LIVENESS_MIN_AMPLITUDE`). Se
 * eligió deliberadamente chico: el objetivo es cortar el empate técnico, no
 * producir rechazos en operación normal. Con dos personas distintas la
 * separación observada es de décimas, no de centésimas. Toda respuesta devuelve
 * `runnerUpDistance` precisamente para poder calibrar esto con padrones reales
 * en vez de a ojo.
 */
export const AMBIGUITY_MARGIN = 0.02;

/** Largo del descriptor de face-api. Un vector de otro largo no es comparable. */
export const DESCRIPTOR_LENGTH = 128;

export interface CandidatoEnrolado {
  userId: string;
  /** Descriptor serializado como JSON de 128 números, tal como se guarda. */
  template: string;
}

/**
 * Por qué no hubo identificación. Se distinguen porque se resuelven distinto:
 *   `no_match`  → nadie del padrón se parece lo suficiente. Es el caso normal de
 *                 alguien no enrolado.
 *   `ambiguous` → dos personas del padrón quedaron empatadas. NO es "no eres tú":
 *                 es "no puedo decir cuál de los dos eres", y se resuelve
 *                 repitiendo la toma o revisando enrolamientos duplicados.
 *   `empty`     → no había a quién comparar (padrón vacío).
 *   `bad_input` → el descriptor vivo llegó mal formado.
 */
export type MatchReason = 'ok' | 'no_match' | 'ambiguous' | 'empty' | 'bad_input';

export interface MatchResult {
  matched: boolean;
  reason: MatchReason;
  userId: string | null;
  /** Distancia del mejor candidato. `null` si no hubo a quién comparar. */
  distance: number | null;
  /**
   * Distancia del segundo mejor. Es el número que permite decidir algún día si
   * `AMBIGUITY_MARGIN` está bien puesto; `null` cuando el padrón tiene un solo
   * candidato comparable.
   */
  runnerUpDistance: number | null;
  threshold: number;
  /** Candidatos que se pudieron comparar (los templates ilegibles no cuentan). */
  evaluated: number;
}

/**
 * Convierte el template guardado en un vector comparable. Devuelve `null` en vez
 * de lanzar: un template corrupto de UNA persona no puede tumbar la
 * identificación de toda la faena, tiene que dejarla fuera y seguir.
 */
export function parseDescriptor(template: string | null | undefined): number[] | null {
  if (!template) return null;
  try {
    const parsed = JSON.parse(template);
    if (!Array.isArray(parsed) || parsed.length !== DESCRIPTOR_LENGTH) return null;
    for (const n of parsed) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

/**
 * Distancia euclidiana entre dos descriptores. Es la misma que calcula
 * `faceapi.euclideanDistance`; se reimplementa acá porque cargar TensorFlow.js en
 * una ruta de servidor para hacer una raíz cuadrada sería absurdo, y porque así
 * la fórmula queda bajo test.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Descriptores de largo distinto: ${a.length} vs ${b.length}`);
  }
  let suma = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    suma += d * d;
  }
  return Math.sqrt(suma);
}

/**
 * Verificación 1:1 — ¿el rostro vivo es el de este trabajador?
 */
export function verifyAgainst(
  live: number[] | null,
  template: string | null | undefined,
  threshold: number = MATCH_THRESHOLD,
): MatchResult {
  const base = { threshold, runnerUpDistance: null, evaluated: 0 };

  if (!live || live.length !== DESCRIPTOR_LENGTH) {
    return { ...base, matched: false, reason: 'bad_input', userId: null, distance: null };
  }

  const guardado = parseDescriptor(template);
  if (!guardado) {
    // Sin template legible no hay veredicto posible. Devolver "no coincide"
    // acusaría de impostor a quien simplemente no está enrolado.
    return { ...base, matched: false, reason: 'empty', userId: null, distance: null };
  }

  const distance = euclideanDistance(live, guardado);
  return {
    ...base,
    evaluated: 1,
    matched: distance < threshold,
    reason: distance < threshold ? 'ok' : 'no_match',
    userId: null,
    distance,
  };
}

/**
 * Búsqueda 1:N — ¿quién del padrón es el rostro vivo?
 *
 * Además del mejor candidato exige **separación respecto al segundo mejor**. Sin
 * eso, el sistema se quedaba con el mínimo aunque hubiera un empate: con pocos
 * enrolados no se nota, pero el riesgo de falso positivo crece con el tamaño del
 * padrón, y un falso positivo acá significa dejar una herramienta a nombre de
 * otra persona.
 */
export function findBestMatch(
  live: number[] | null,
  candidatos: CandidatoEnrolado[],
  threshold: number = MATCH_THRESHOLD,
  margin: number = AMBIGUITY_MARGIN,
): MatchResult {
  const base = { threshold, userId: null, distance: null, runnerUpDistance: null, evaluated: 0 };

  if (!live || live.length !== DESCRIPTOR_LENGTH) {
    return { ...base, matched: false, reason: 'bad_input' };
  }

  let mejor: { userId: string; distance: number } | null = null;
  let segundo: number | null = null;
  let evaluated = 0;

  for (const c of candidatos) {
    const guardado = parseDescriptor(c.template);
    if (!guardado) continue; // template ilegible: se salta, no rompe la búsqueda
    evaluated++;

    const d = euclideanDistance(live, guardado);
    if (!mejor || d < mejor.distance) {
      segundo = mejor ? mejor.distance : segundo;
      mejor = { userId: c.userId, distance: d };
    } else if (segundo === null || d < segundo) {
      segundo = d;
    }
  }

  if (!mejor) {
    return { ...base, matched: false, reason: 'empty', evaluated };
  }

  const comun = {
    threshold,
    evaluated,
    distance: mejor.distance,
    runnerUpDistance: segundo,
  };

  if (mejor.distance >= threshold) {
    return { ...comun, matched: false, reason: 'no_match', userId: null };
  }

  // Empate técnico: los dos candidatos están dentro del ruido uno del otro.
  // Se devuelve QUIÉN iba ganando —sirve para diagnosticar enrolamientos
  // duplicados— pero sin darlo por identificado.
  if (segundo !== null && segundo - mejor.distance < margin) {
    return { ...comun, matched: false, reason: 'ambiguous', userId: mejor.userId };
  }

  return { ...comun, matched: true, reason: 'ok', userId: mejor.userId };
}
