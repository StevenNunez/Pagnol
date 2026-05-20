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
      return { success: false, message: "No se detectó ningún rostro. Asegure buena iluminación y mire de frente." };
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
): Promise<{ verified: boolean; score: number; message: string }> => {
  if (!modelsLoaded) await loadBiometricModels();
  const fa = await getFaceApi();

  try {
    // 1. Obtener descriptor en vivo
    const detection = await fa.detectSingleFace(input).withFaceLandmarks().withFaceDescriptor();

    if (!detection) {
      return { verified: false, score: 0, message: "No se detecta rostro en vivo." };
    }

    // 2. Parsear template guardado
    const savedDescriptorArray = JSON.parse(savedTemplate);
    const savedDescriptor = new Float32Array(savedDescriptorArray);

    // 3. Comparar (Distancia Euclidiana)
    // Un valor menor a 0.6 suele ser el umbral estándar. Cuanto menor, más parecido.
    const distance = fa.euclideanDistance(detection.descriptor, savedDescriptor);

    // Score inverso para mostrar % (0.6 dist = 100% threshold match aprox, pero mostraremos confianza)
    // Mapeamos distancia 0 -> 100%, 0.6 -> 50%
    const threshold = 0.5;
    const isMatch = distance < threshold;

    console.log(`Distancia Biométrica: ${distance} (Umbral: ${threshold})`);

    return { verified: isMatch, score: distance, message: isMatch ? "Identidad Verificada" : "No coincide la persona" };

  } catch (error) {
    console.error("Error verificando identidad:", error);
    return { verified: false, score: 0, message: "Error técnico durante la verificación." };
  }
};

/**
 * Función de alto nivel para verificar biometría (usada en MovimientosPage)
 */
export const verifyBiometric = async (
  savedTemplate: string,
  setStatus?: (status: string) => void,
  videoElement?: HTMLVideoElement
): Promise<boolean> => {
  if (!savedTemplate) return false;

  try {
    if (setStatus) setStatus("Iniciando verificación...");

    // Intentar buscar el video en el DOM si no se provee
    const video = videoElement || document.querySelector('video');
    if (!video) {
      if (setStatus) setStatus("Error: Cámara no encontrada.");
      return false;
    }

    if (setStatus) setStatus("Analizando rostro...");
    const result = await verifyIdentity(video, savedTemplate);

    if (setStatus) setStatus(result.message);
    return result.verified;

  } catch (error) {
    console.error("Error en verifyBiometric:", error);
    if (setStatus) setStatus("Error en el proceso.");
    return false;
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
    const threshold = 0.5;

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

