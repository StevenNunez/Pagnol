/**
 * @fileoverview
 * Servicio Biométrico PAGNOL (Powered by Face-API.js)
 * Realiza detección facial, extracción de características y verificación 1:1 en el navegador.
 */

import {
  evaluateLivenessSequence,
  type LivenessChallenge,
  type LivenessResult,
  type LivenessSample,
} from '@/modules/data/mutations/livenessMath';
import { MATCH_THRESHOLD, type MatchReason } from '@/modules/data/mutations/matchMath';
import { authHeaders } from '@/modules/core/lib/auth-header';

const MODEL_URL = '/models';
let modelsLoaded = false;

// Dynamic import to avoid TextEncoder SSR crash with @vladmandic/face-api
let faceapi: typeof import('@vladmandic/face-api') | null = null;
const getFaceApi = async () => {
  if (!faceapi) faceapi = await import('@vladmandic/face-api');
  return faceapi;
};

/**
 * Por qué falló una verificación. Existe porque "no te encontré la cara" y "no
 * eres tú" se resuelven de forma distinta —el primero acercándose a la cámara,
 * el segundo llamando a otra persona— y colapsarlos en un `false` hacía que la
 * pantalla acusara de impostor a quien sólo estaba mal encuadrado.
 */
export type BiometricFailureReason = 'ok' | 'no_face' | 'no_match' | 'error';

/** Mensaje único para el caso "no se detectó rostro", para no repetirlo. */
export const NO_FACE_MESSAGE =
  "No se detectó ningún rostro. Acércate a la cámara, mira de frente y busca buena iluminación.";

/**
 * Umbral de coincidencia. Se re-exporta desde `matchMath` para que el cliente lo
 * pueda mostrar en pantalla y guardarlo con la evidencia, pero **el que decide
 * es el del servidor**: desde la bóveda biométrica la comparación ocurre en
 * `/api/biometric/match`, así que cambiar este valor en las devtools no mueve
 * ningún veredicto. Los números medidos y la advertencia de calibración viven en
 * `matchMath.ts`, junto a la constante real.
 */
export { MATCH_THRESHOLD };

/**
 * Frame del momento de la verificación, para respaldarla. Sin esto la biometría
 * es un portón en la pantalla y no evidencia: ante un reclamo no habría nada que
 * mostrar salvo que el software dijo que sí.
 */
export const captureEvidenceFrame = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  maxWidth = 640,
): Promise<Blob | null> => {
  try {
    const ancho = (input as HTMLVideoElement).videoWidth || (input as HTMLImageElement).width;
    const alto = (input as HTMLVideoElement).videoHeight || (input as HTMLImageElement).height;
    if (!ancho || !alto) return null;

    const escala = Math.min(1, maxWidth / ancho);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(ancho * escala);
    canvas.height = Math.round(alto * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(input, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>(res =>
      canvas.toBlob(b => res(b), 'image/jpeg', 0.75)
    );
  } catch (e) {
    console.warn('No se pudo capturar el frame de evidencia:', e);
    return null;
  }
};

export interface BiometricResult {
  success: boolean;
  message: string;
  template?: string; // JSON stringified descriptor (number[])
  imageUrl?: string;
  descriptor?: Float32Array;
}

/**
 * Carga los modelos de ML necesarios en memoria.
 */
export const loadBiometricModels = async () => {
  if (modelsLoaded) return;
  try {
    console.log("Cargando modelos biométricos...");
    const fa = await getFaceApi();
    await fa.nets.ssdMobilenetv1.loadFromUri(MODEL_URL);
    await fa.nets.faceLandmark68Net.loadFromUri(MODEL_URL);
    await fa.nets.faceRecognitionNet.loadFromUri(MODEL_URL);
    modelsLoaded = true;
    console.log("Modelos biométricos cargados.");
  } catch (error) {
    console.error("Error cargando modelos biométricos:", error);
    throw new Error("No se pudieron cargar los modelos de IA.");
  }
};

/**
 * Detecta un rostro en el elemento de video y extrae su descriptor biométrico.
 */
export const captureBiometrics = async (input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<BiometricResult> => {
  if (!modelsLoaded) await loadBiometricModels();
  const fa = await getFaceApi();

  try {
    // 1. Detectar rostro mas confiable
    const detection = await fa.detectSingleFace(input).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      return { success: false, message: NO_FACE_MESSAGE };
    }

    const { descriptor } = detection;

    // 2. Comprobaciones de calidad básicas (opcional: verificar tamaño, angulo)
    // Por ahora confiamos en el detector.

    // 3. Convertir descriptor a formato guardable
    const descriptorArray = Array.from(descriptor);
    const template = JSON.stringify(descriptorArray);

    return {
      success: true,
      message: "Biometría capturada exitosamente.",
      template,
      descriptor: descriptor
    };

  } catch (error: any) {
    console.error("Error en captura biométrica:", error);
    return { success: false, message: error.message || "Error al procesar la imagen." };
  }
};

/**
 * Extrae el descriptor de quien está frente a la cámara. Es lo ÚNICO biométrico
 * que este archivo produce desde el cierre de la bóveda: la cara de la persona
 * presente en ese instante, que ya está delante del lente. Los descriptores
 * ENROLADOS (los de terceros) no llegan nunca al navegador.
 */
const extraerDescriptorVivo = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<number[] | null> => {
  if (!modelsLoaded) await loadBiometricModels();
  const fa = await getFaceApi();
  const detection = await fa.detectSingleFace(input).withFaceLandmarks().withFaceDescriptor();
  return detection ? Array.from(detection.descriptor) : null;
};

/** Respuesta de `/api/biometric/match`. Nunca incluye un template. */
interface RespuestaMatch {
  matched: boolean;
  reason: MatchReason;
  userId: string | null;
  distance: number | null;
  runnerUpDistance: number | null;
  threshold: number;
  evaluated: number;
  error?: string;
}

const pedirMatch = async (
  body: { mode: '1:1' | '1:N'; descriptor: number[]; userId?: string },
): Promise<RespuestaMatch | null> => {
  const res = await fetch('/api/biometric/match', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    console.error('[biometric/match]', res.status, json?.error);
    return null;
  }
  return json as RespuestaMatch;
};

/**
 * Verifica si el rostro en el video corresponde a un trabajador determinado.
 *
 * ⚠️ Recibe el **id del trabajador**, no su template: el descriptor enrolado ya
 * no existe en el navegador. Antes esta función tomaba el template como
 * argumento, y ese argumento sólo se podía llenar bajándose de `profiles` un
 * dato biométrico que la RLS por fila entregaba a cualquier miembro del tenant.
 */
export const verifyIdentity = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  userId: string,
): Promise<{ verified: boolean; score: number; message: string; reason: BiometricFailureReason }> => {
  try {
    const live = await extraerDescriptorVivo(input);

    if (!live) {
      // NO es "no eres tú": es "no te vi la cara". Son dos problemas distintos con
      // dos soluciones distintas (acercarse a la cámara vs. no coincide la persona),
      // y hasta ahora los dos llegaban a la pantalla como "Fallo biométrico".
      return { verified: false, score: 0, message: NO_FACE_MESSAGE, reason: 'no_face' };
    }

    const r = await pedirMatch({ mode: '1:1', descriptor: live, userId });
    if (!r) {
      return { verified: false, score: 0, message: "No se pudo verificar contra el servidor.", reason: 'error' };
    }

    // `empty` = el trabajador no tiene biometría enrolada. Decir "no coincide"
    // acusaría de impostor a quien simplemente nunca fue enrolado.
    if (r.reason === 'empty') {
      return { verified: false, score: 0, message: "Este trabajador no tiene biometría enrolada.", reason: 'error' };
    }
    if (r.reason === 'bad_input') {
      return { verified: false, score: 0, message: "Error técnico durante la verificación.", reason: 'error' };
    }

    return {
      verified: r.matched,
      score: r.distance ?? 0,
      message: r.matched ? "Identidad Verificada" : "No coincide la persona",
      reason: r.matched ? 'ok' : 'no_match',
    };

  } catch (error) {
    console.error("Error verificando identidad:", error);
    return { verified: false, score: 0, message: "Error técnico durante la verificación.", reason: 'error' };
  }
};

/**
 * Función de alto nivel para verificar biometría (usada en MovimientosPage)
 */
export interface BiometricCheck {
  verified: boolean;
  reason: BiometricFailureReason;
  message: string;
  score: number;
}

/**
 * Función de alto nivel para verificar biometría (usada en MovimientosPage).
 *
 * Devuelve el motivo además del veredicto: quien la llama necesita distinguir
 * "no se detectó rostro" de "no coincide la persona" para poder decirle al
 * trabajador qué hacer. Sigue siendo compatible con `if (result.verified)`.
 */
export const verifyBiometric = async (
  userId: string,
  setStatus?: (status: string) => void,
  videoElement?: HTMLVideoElement
): Promise<BiometricCheck> => {
  if (!userId) {
    return { verified: false, reason: 'error', message: "No se indicó a quién verificar.", score: 0 };
  }

  try {
    if (setStatus) setStatus("Iniciando verificación...");

    // Antes, sin elemento explícito, se caía a `document.querySelector('video')`
    // —el PRIMER <video> del documento, que no tiene por qué ser el de la cámara—.
    // Verificar la identidad contra el elemento equivocado es peor que no
    // verificar: da un veredicto con toda la apariencia de ser válido. Si quien
    // llama no pasa el elemento, esto falla y lo dice.
    const video = videoElement;
    if (!video) {
      if (setStatus) setStatus("Error: Cámara no encontrada.");
      return { verified: false, reason: 'error', message: "No se encontró la cámara.", score: 0 };
    }

    if (setStatus) setStatus("Analizando rostro...");
    const result = await verifyIdentity(video, userId);

    if (setStatus) setStatus(result.message);
    return { verified: result.verified, reason: result.reason, message: result.message, score: result.score };

  } catch (error) {
    console.error("Error en verifyBiometric:", error);
    if (setStatus) setStatus("Error en el proceso.");
    return { verified: false, reason: 'error', message: "Error técnico durante la verificación.", score: 0 };
  }
};

// ── Detección de vida ────────────────────────────────────────────────────────

/** Milisegundos entre muestras. ~8 por segundo alcanza de sobra para un parpadeo. */
export const LIVENESS_SAMPLE_MS = 120;

/**
 * Ventana máxima del desafío. Seis segundos es lo que aguanta alguien parado en
 * el pañol con una herramienta en la mano; más que eso y el gesto se abandona.
 */
export const LIVENESS_WINDOW_MS = 6000;

/**
 * Pide un gesto y observa si ocurre de verdad.
 *
 * Muestrea landmarks **sin descriptor**: `withFaceDescriptor()` corre la red de
 * reconocimiento, que es la parte cara de los 300–700 ms medidos. Saltársela es
 * lo que hace viable muestrear durante segundos en vez de una sola vez.
 *
 * Sale apenas el gesto se completa, así que a quien parpadea de inmediato no le
 * cuesta la ventana entera. La decisión de si esto bloquea o no NO vive aquí:
 * este servicio mide y reporta.
 */
export const verifyLiveness = async (
  video: HTMLVideoElement,
  challenge: LivenessChallenge,
  opts?: { windowMs?: number; onSample?: (parcial: LivenessResult) => void },
): Promise<LivenessResult> => {
  if (!modelsLoaded) await loadBiometricModels();
  const fa = await getFaceApi();

  const windowMs = opts?.windowMs ?? LIVENESS_WINDOW_MS;
  const deadline = Date.now() + windowMs;
  const samples: LivenessSample[] = [];

  try {
    while (Date.now() < deadline) {
      const inicio = Date.now();
      // Mismo detector que la verificación de identidad, a propósito: si aquí se
      // afinara distinto, el gesto podría exigir una detección que la puerta de
      // al lado no consigue, y el trabajador vería resultados contradictorios.
      const detection = await fa.detectSingleFace(video).withFaceLandmarks();

      samples.push({
        landmarks: detection ? detection.landmarks.positions.map(p => ({ x: p.x, y: p.y })) : null,
        at: Date.now(),
      });

      const parcial = evaluateLivenessSequence(samples, challenge);
      opts?.onSample?.(parcial);
      if (parcial.passed) return parcial;

      const resto = LIVENESS_SAMPLE_MS - (Date.now() - inicio);
      if (resto > 0) await new Promise(r => setTimeout(r, resto));
    }

    return evaluateLivenessSequence(samples, challenge);
  } catch (error) {
    console.error('Error durante la prueba de vida:', error);
    // Se devuelve lo observado hasta el fallo en vez de un veredicto inventado:
    // en modo observación este resultado se guarda como evidencia.
    return evaluateLivenessSequence(samples, challenge);
  }
};

/**
 * Búsqueda 1:N: ¿quién del padrón es el rostro que está frente a la cámara?
 *
 * ⚠️ Ya NO recibe el padrón. Antes había que pasarle la lista de trabajadores
 * con sus templates, lo que obligaba a que el navegador tuviera descargados los
 * descriptores faciales de toda la faena. Ahora manda el descriptor vivo y el
 * servidor resuelve contra la bóveda, acotado al tenant del llamante.
 *
 * `reason` distingue el caso que antes se perdía: `ambiguous` significa que dos
 * enrolados quedaron empatados —normalmente porque la misma cara está enrolada
 * dos veces— y NO es lo mismo que "no te reconozco".
 */
export const searchIdentity1N = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<{
  success: boolean;
  userId?: string;
  distance?: number;
  /**
   * Distancia del segundo mejor candidato. Es EL número que permite distinguir
   * un empate técnico de un "no te reconozco", y sin él `ambiguous` llega a la
   * pantalla sin nada que explicar por qué. Se propaga aunque hoy sólo lo use el
   * diagnóstico: es lo que hace falta para calibrar `AMBIGUITY_MARGIN` con
   * padrones reales, que hoy es un valor razonado y no medido.
   */
  runnerUpDistance?: number;
  reason?: MatchReason;
  evaluated?: number;
}> => {
  try {
    const live = await extraerDescriptorVivo(input);
    // Sin rostro detectado no hay descriptor que mandar. NO es "no te reconozco":
    // es "no te vi la cara", y se resuelve acercándose, no cambiando de persona.
    if (!live) return { success: false, reason: 'bad_input' };

    const r = await pedirMatch({ mode: '1:N', descriptor: live });
    if (!r) return { success: false };

    return {
      success: r.matched,
      userId: r.userId ?? undefined,
      distance: r.distance ?? undefined,
      runnerUpDistance: r.runnerUpDistance ?? undefined,
      reason: r.reason,
      evaluated: r.evaluated,
    };
  } catch (err) {
    console.error("1:N Search error:", err);
    return { success: false };
  }
};




// Wrappers antiguos para compatibilidad con el código existente (si es necesario)
// Se recomienda usar captureBiometrics directamente.
export const enrollBiometric = async (
  type: 'fingerprint' | 'face',
  workerName: string,
  workerEmail: string,
  setStatus: (status: string) => void,
  videoElement?: HTMLVideoElement // Nuevo parámetro opcional
): Promise<any> => {
  if (type === 'fingerprint') {
    return { success: false, message: "Soporte de huella aún requiere hardware específico." };
  }

  if (!videoElement) {
    return { success: false, message: "Se requiere acceso a cámara para biometría facial real." };
  }

  setStatus("Analizando rostro con IA...");
  const result = await captureBiometrics(videoElement);

  if (result.success) {
    // Generamos una imagen del rostro para feedback visual
    // Nota: En producción, `captureBiometrics` podría devolver el recorte del rostro.
    // Por ahora usamos lo que el componente ya capturó en el canvas.
    return {
      success: true,
      message: "Rostro digitalizado correctamente.",
      template: result.template,
      imageUrl: null // El componente maneja la imagen visual
    };
  }

  return result;
};

