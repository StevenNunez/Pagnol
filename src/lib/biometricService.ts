/**
 * @fileoverview
 * Servicio Biométrico PAGNOL (Powered by Face-API.js)
 * Realiza detección facial, extracción de características y verificación 1:1 en el navegador.
 */

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
 * Umbral de coincidencia (distancia euclidiana; menor = más parecido). Vive en
 * una sola constante porque antes estaba escrito a mano en `verifyIdentity` y en
 * `searchIdentity1N`, y dos umbrales que deben ser iguales terminan no siéndolo.
 *
 * ⚠️ Medido el 2026-08-11 contra datos reales: entre personas distintas la
 * distancia dio 0,72–0,73, pero entre dos capturas de la MISMA persona dio
 * 0,427 — o sea que este 0,5 deja apenas un 15% de margen antes de rechazar a
 * quien sí corresponde. Está apretado por el lado equivocado. No moverlo a ojo:
 * hay que medir el inter-persona con capturas de la cámara real, no con fotos.
 * Cada verificación guarda el umbral con el que se resolvió, justamente para que
 * recalibrarlo no vuelva ilegible la evidencia vieja.
 */
export const MATCH_THRESHOLD = 0.5;

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
 * Verifica si el rostro en el video coincide con el template guardado.
 */
export const verifyIdentity = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  savedTemplate: string
): Promise<{ verified: boolean; score: number; message: string; reason: BiometricFailureReason }> => {
  if (!modelsLoaded) await loadBiometricModels();
  const fa = await getFaceApi();

  try {
    // 1. Obtener descriptor en vivo
    const detection = await fa.detectSingleFace(input).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      // NO es "no eres tú": es "no te vi la cara". Son dos problemas distintos con
      // dos soluciones distintas (acercarse a la cámara vs. no coincide la persona),
      // y hasta ahora los dos llegaban a la pantalla como "Fallo biométrico".
      return { verified: false, score: 0, message: NO_FACE_MESSAGE, reason: 'no_face' };
    }

    // 2. Parsear template guardado
    const savedDescriptorArray = JSON.parse(savedTemplate);
    const savedDescriptor = new Float32Array(savedDescriptorArray);

    // 3. Comparar (Distancia Euclidiana)
    // Un valor menor a 0.6 suele ser el umbral estándar. Cuanto menor, más parecido.
    const distance = fa.euclideanDistance(detection.descriptor, savedDescriptor);

    const threshold = MATCH_THRESHOLD;
    const isMatch = distance < threshold;

    console.log(`Distancia Biométrica: ${distance} (Umbral: ${threshold})`);

    return {
      verified: isMatch,
      score: distance,
      message: isMatch ? "Identidad Verificada" : "No coincide la persona",
      reason: isMatch ? 'ok' : 'no_match',
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
  savedTemplate: string,
  setStatus?: (status: string) => void,
  videoElement?: HTMLVideoElement
): Promise<BiometricCheck> => {
  if (!savedTemplate) {
    return { verified: false, reason: 'error', message: "Este trabajador no tiene biometría enrolada.", score: 0 };
  }

  try {
    if (setStatus) setStatus("Iniciando verificación...");

    // Sin elemento explícito se cae al primer <video> del documento, que no tiene
    // por qué ser el de la cámara: quien llama debería pasarlo siempre.
    const video = videoElement || document.querySelector('video');
    if (!video) {
      if (setStatus) setStatus("Error: Cámara no encontrada.");
      return { verified: false, reason: 'error', message: "No se encontró la cámara.", score: 0 };
    }

    if (setStatus) setStatus("Analizando rostro...");
    const result = await verifyIdentity(video, savedTemplate);

    if (setStatus) setStatus(result.message);
    return { verified: result.verified, reason: result.reason, message: result.message, score: result.score };

  } catch (error) {
    console.error("Error en verifyBiometric:", error);
    if (setStatus) setStatus("Error en el proceso.");
    return { verified: false, reason: 'error', message: "Error técnico durante la verificación.", score: 0 };
  }
};

/**
 * Realiza búsqueda 1:N para identificar a un usuario entre una lista.
 */
export const searchIdentity1N = async (
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
  enrolledUsers: { id: string, biometric_template?: string | null }[]
): Promise<{ success: boolean, userId?: string, distance?: number }> => {
  try {
    if (!modelsLoaded) await loadBiometricModels();
    const fa = await getFaceApi();
    const detection = await fa.detectSingleFace(input).withFaceLandmarks().withFaceDescriptor();
    if (!detection) return { success: false };

    let bestMatch = { userId: '', distance: 1.0 };
    const threshold = MATCH_THRESHOLD;

    for (const user of enrolledUsers) {
      if (!user.biometric_template) continue;

      const savedDescriptor = new Float32Array(JSON.parse(user.biometric_template));
      const distance = fa.euclideanDistance(detection.descriptor, savedDescriptor);

      if (distance < bestMatch.distance) {
        bestMatch = { userId: user.id, distance };
      }
    }

    if (bestMatch.distance < threshold) {
      return { success: true, userId: bestMatch.userId, distance: bestMatch.distance };
    }

    return { success: false };
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

