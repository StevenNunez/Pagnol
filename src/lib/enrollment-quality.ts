/**
 * Calidad del enrolamiento facial.
 *
 * Por qué existe: hasta ahora se guardaba **el primer descriptor que saliera**,
 * sin exigir tamaño, nitidez ni varias tomas — el código lo decía: *"Por ahora
 * confiamos en el detector"*. Y la calidad del enrolamiento manda sobre todo lo
 * demás: con un template pobre **no existe umbral que acierte siempre**.
 *
 * No es teoría. Medido sobre los 35 enrolados de Valar el 2026-09-04, tomando
 * para cada persona su distancia a la persona más parecida:
 *
 *   · 2 personas quedaron a **0,500** una de otra — exactamente el umbral de
 *     identidad, o sea el sistema las puede confundir entre sí.
 *   · 25 de 35 (71%) quedaron en el margen estrecho 0,5–0,6.
 *   · Sólo 8 quedaron bien separadas (> 0,6).
 *   · Mediana de separación: 0,559, apenas encima del umbral de 0,5.
 *
 * Un enrolamiento bueno separa; uno pobre deja a dos personas pegadas. Estas
 * comprobaciones existen para que lo que se guarda de ahora en adelante separe.
 */

/** Qué tan grande debe verse el rostro dentro del encuadre para enrolar. */
export const MIN_FACE_RATIO_ENROLL = 0.14;
/** Para verificar (no enrolar) se acepta más chico: el trabajador está de paso. */
export const MIN_FACE_RATIO_VERIFY = 0.07;
/** Confianza mínima del detector. Bajo esto, lo que encontró no es un rostro. */
export const MIN_DETECTION_SCORE = 0.55;
/** Tomas que se promedian al enrolar. */
export const ENROLL_SAMPLES = 4;
/**
 * Dos tomas de la misma persona en segundos seguidos deben parecerse mucho. Si
 * se separan más que esto, algo cambió entre medio —se movió otra persona
 * frente a la cámara, o el detector agarró otra cara— y promediarlas produciría
 * un template que no es de nadie.
 */
export const MAX_SAMPLE_SPREAD = 0.45;

export type MotivoRechazo = 'cara_lejos' | 'poca_confianza' | 'tomas_inconsistentes';

export interface EvaluacionToma {
    ok: boolean;
    motivo?: MotivoRechazo;
    /** Mensaje para el usuario, en lenguaje de faena. */
    mensaje?: string;
    /** Proporción del ancho del encuadre que ocupa el rostro. */
    proporcion: number;
}

/**
 * ¿Sirve esta toma?
 *
 * El caso que más duele en faena es el rostro chico dentro de un plano medio
 * —el trabajador parado lejos de la tablet—, que hoy termina en "No se detectó
 * ningún rostro" repetido. Acá se distingue: si hay cara pero está lejos, se
 * dice **"acércate"**, que es accionable, en vez de fallar en silencio.
 */
export function evaluarToma(
    caja: { width: number; height: number },
    encuadre: { width: number; height: number },
    score: number,
    minRatio: number = MIN_FACE_RATIO_ENROLL,
): EvaluacionToma {
    const proporcion = encuadre.width > 0 ? caja.width / encuadre.width : 0;

    if (score < MIN_DETECTION_SCORE) {
        return {
            ok: false, motivo: 'poca_confianza', proporcion,
            mensaje: 'No se ve bien el rostro. Busca mejor luz y mira de frente a la cámara.',
        };
    }
    if (proporcion < minRatio) {
        return {
            ok: false, motivo: 'cara_lejos', proporcion,
            mensaje: 'Acércate a la cámara: el rostro se ve muy pequeño.',
        };
    }
    return { ok: true, proporcion };
}

/**
 * Promedia varias tomas en un solo template, y rechaza el conjunto si las tomas
 * no se parecen entre sí.
 *
 * Promediar es lo que sube la calidad: cada toma trae ruido distinto (un gesto,
 * una sombra, un ángulo) y el promedio conserva lo que se repite —la persona— y
 * diluye lo que no. Pero promediar tomas de personas distintas produce un
 * template intermedio que no identifica a ninguna, y ese es el peor resultado
 * posible: no falla, identifica mal.
 */
export function promediarTomas(
    tomas: number[][],
    distancia: (a: number[], b: number[]) => number,
): { ok: true; template: number[]; dispersion: number } | { ok: false; motivo: MotivoRechazo; mensaje: string; dispersion: number } {
    if (tomas.length === 0) {
        return { ok: false, motivo: 'tomas_inconsistentes', mensaje: 'No se capturó ninguna toma válida.', dispersion: 0 };
    }
    if (tomas.length === 1) {
        return { ok: true, template: [...tomas[0]], dispersion: 0 };
    }

    // Dispersión: la mayor distancia entre dos tomas cualesquiera.
    let dispersion = 0;
    for (let i = 0; i < tomas.length; i++) {
        for (let j = i + 1; j < tomas.length; j++) {
            const d = distancia(tomas[i], tomas[j]);
            if (d > dispersion) dispersion = d;
        }
    }
    if (dispersion > MAX_SAMPLE_SPREAD) {
        return {
            ok: false, motivo: 'tomas_inconsistentes', dispersion,
            mensaje: 'Las tomas salieron muy distintas entre sí. Quédate quieto frente a la cámara y repite el enrolamiento.',
        };
    }

    const largo = tomas[0].length;
    const promedio = new Array<number>(largo).fill(0);
    for (const t of tomas) {
        for (let i = 0; i < largo; i++) promedio[i] += t[i];
    }
    for (let i = 0; i < largo; i++) promedio[i] /= tomas.length;

    return { ok: true, template: promedio, dispersion };
}

/**
 * ¿Este enrolamiento necesita rehacerse?
 *
 * Se mide contra la gente ya enrolada: si el template más parecido de OTRA
 * persona está más cerca que el umbral de identidad, esas dos se pueden
 * confundir y hay que rehacer al menos una.
 *
 * Sirve para no pedirle a todo el mundo que se vuelva a enrolar —que en una
 * faena con gente ya enrolada es carísimo— sino sólo a quienes de verdad lo
 * necesitan.
 */
export type NivelRiesgo = 'confundible' | 'margen_estrecho' | 'bien';

export function evaluarSeparacion(distanciaAlMasParecido: number, umbral: number): NivelRiesgo {
    if (distanciaAlMasParecido < umbral) return 'confundible';
    if (distanciaAlMasParecido < umbral + 0.1) return 'margen_estrecho';
    return 'bien';
}
