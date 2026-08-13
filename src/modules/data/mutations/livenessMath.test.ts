import { describe, it, expect } from 'vitest';
import {
  eyeAspectRatio,
  blinkRatio,
  mouthRatio,
  challengeRatio,
  pickChallenge,
  evaluateLivenessSequence,
  LIVENESS_MIN_AMPLITUDE,
  LIVENESS_THRESHOLDS,
  type Punto,
  type LivenessSample,
} from './livenessMath';

/**
 * Construye 68 landmarks sintéticos cuyo EAR y MAR son EXACTAMENTE los pedidos.
 *
 * Las razones son adimensionales, así que basta con fabricar la geometría con la
 * proporción correcta: no hace falta una cara realista para probar la máquina de
 * estados, y una cara realista escondería los bordes que sí importan.
 */
const cara = (ear: number, mar: number): Punto[] => {
  const pts: Punto[] = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));

  // Ojo: ancho 10, alto 10·ear en los dos pares verticales → EAR = ear.
  const ojo = (base: number, cx: number) => {
    pts[base + 0] = { x: cx, y: 0 };
    pts[base + 1] = { x: cx + 3, y: -5 * ear };
    pts[base + 2] = { x: cx + 7, y: -5 * ear };
    pts[base + 3] = { x: cx + 10, y: 0 };
    pts[base + 4] = { x: cx + 7, y: 5 * ear };
    pts[base + 5] = { x: cx + 3, y: 5 * ear };
  };
  ojo(36, 0);
  ojo(42, 20);

  // Boca interior: ancho 20, alto 20·mar en los tres pares → MAR = mar.
  pts[60] = { x: 0, y: 100 };
  pts[61] = { x: 5, y: 100 - 10 * mar };
  pts[62] = { x: 10, y: 100 - 10 * mar };
  pts[63] = { x: 15, y: 100 - 10 * mar };
  pts[64] = { x: 20, y: 100 };
  pts[65] = { x: 15, y: 100 + 10 * mar };
  pts[66] = { x: 10, y: 100 + 10 * mar };
  pts[67] = { x: 5, y: 100 + 10 * mar };

  return pts;
};

/** Valores de reposo: ojos abiertos, boca cerrada. */
const OJO_ABIERTO = 0.3;
const OJO_CERRADO = 0.1;
const BOCA_CERRADA = 0.05;
const BOCA_ABIERTA = 0.6;

/** Arma la secuencia con marcas de tiempo de ~10 fps. */
const secuencia = (caras: (Punto[] | null)[]): LivenessSample[] =>
  caras.map((landmarks, i) => ({ landmarks, at: 1000 + i * 100 }));

describe('razones geométricas', () => {
  it('EAR es la proporción alto/ancho del ojo', () => {
    expect(eyeAspectRatio(cara(0.3, 0.05), [36, 37, 38, 39, 40, 41])).toBeCloseTo(0.3, 6);
  });

  it('blinkRatio promedia ambos ojos', () => {
    expect(blinkRatio(cara(0.25, 0.05))).toBeCloseTo(0.25, 6);
  });

  it('mouthRatio mide la boca interior', () => {
    expect(mouthRatio(cara(0.3, 0.6))).toBeCloseTo(0.6, 6);
  });

  it('es invariante a la escala del rostro en el encuadre', () => {
    // La misma cara al doble de tamaño (trabajador más cerca de la tablet) debe
    // dar la misma razón: si no, el umbral dependería de la distancia.
    const chica = cara(0.28, 0.4);
    const grande = chica.map(p => ({ x: p.x * 2.5, y: p.y * 2.5 }));
    expect(blinkRatio(grande)).toBeCloseTo(blinkRatio(chica), 6);
    expect(mouthRatio(grande)).toBeCloseTo(mouthRatio(chica), 6);
  });

  it('no devuelve NaN si el ancho degenera a cero', () => {
    const plana: Punto[] = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
    expect(blinkRatio(plana)).toBe(0);
    expect(mouthRatio(plana)).toBe(0);
  });

  it('challengeRatio elige la razón del desafío pedido', () => {
    const c = cara(0.3, 0.6);
    expect(challengeRatio(c, 'blink')).toBeCloseTo(0.3, 6);
    expect(challengeRatio(c, 'mouth')).toBeCloseTo(0.6, 6);
  });
});

describe('pickChallenge', () => {
  it('es determinista dado el aleatorio', () => {
    expect(pickChallenge(0)).toBe('blink');
    expect(pickChallenge(0.49)).toBe('blink');
    expect(pickChallenge(0.5)).toBe('mouth');
    expect(pickChallenge(0.99)).toBe('mouth');
  });
});

describe('evaluateLivenessSequence — parpadeo', () => {
  it('acepta un parpadeo real (abierto → cerrado → abierto)', () => {
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.score).toBeCloseTo(0.2, 6);
    expect(r.frames).toBe(6);
    expect(r.framesLost).toBe(0);
    expect(r.durationMs).toBe(500);
  });

  it('🔴 rechaza una FOTO: rostro presente todo el rato y sin movimiento', () => {
    // Es el ataque que este módulo existe para cortar. El ruido de ±0,004 imita
    // la inestabilidad del landmark sobre una imagen impresa o en pantalla.
    const r = evaluateLivenessSequence(
      secuencia(
        Array.from({ length: 25 }, (_, i) =>
          cara(OJO_ABIERTO + (i % 2 ? 0.004 : -0.004), BOCA_CERRADA),
        ),
      ),
      'blink',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_change');
    expect(r.frames).toBe(25);
    expect(r.score).toBeLessThan(LIVENESS_MIN_AMPLITUDE);
  });

  it('🔴 un video pregrabado de un parpadeo NO satisface el desafío de boca', () => {
    // El argumento entero de que el gesto se sortee: la misma secuencia que pasa
    // como parpadeo tiene que fallar si lo que se pidió fue abrir la boca.
    const parpadeo = secuencia([
      cara(OJO_ABIERTO, BOCA_CERRADA),
      cara(OJO_CERRADO, BOCA_CERRADA),
      cara(OJO_ABIERTO, BOCA_CERRADA),
    ]);
    expect(evaluateLivenessSequence(parpadeo, 'blink').passed).toBe(true);

    const contraBoca = evaluateLivenessSequence(parpadeo, 'mouth');
    expect(contraBoca.passed).toBe(false);
    expect(contraBoca.reason).toBe('no_change');
  });

  it('no acepta el ciclo a medias: cerrar sin volver a abrir', () => {
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(false);
    // Hubo movimiento, así que NO es sospecha de foto: es reintentar.
    expect(r.reason).toBe('timeout');
    expect(r.score).toBeGreaterThan(LIVENESS_MIN_AMPLITUDE);
  });

  it('empezar con los ojos ya cerrados no da el ciclo por cumplido', () => {
    // Sin el neutro previo no hay transición que observar, sólo una postura.
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('timeout');
  });

  it('la histéresis impide que el ruido dentro de la banda cierre el ciclo', () => {
    // 0,19 cae entre `active` (0,15) y `neutral` (0,22): no es ni una cosa ni la
    // otra, y por lo tanto no completa nada.
    expect(LIVENESS_THRESHOLDS.blink.active).toBeLessThan(0.19);
    expect(LIVENESS_THRESHOLDS.blink.neutral).toBeGreaterThan(0.19);
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(0.19, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(0.19, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(false);
  });
});

describe('evaluateLivenessSequence — boca', () => {
  it('acepta abrir y cerrar la boca', () => {
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_ABIERTA),
        cara(OJO_ABIERTO, BOCA_ABIERTA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'mouth',
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.score).toBeCloseTo(0.55, 6);
  });

  it('abrir la boca y dejarla abierta no cierra el ciclo', () => {
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_ABIERTA),
        cara(OJO_ABIERTO, BOCA_ABIERTA),
      ]),
      'mouth',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('timeout');
  });
});

describe('evaluateLivenessSequence — rostro perdido', () => {
  it('sin ningún rostro devuelve no_face, no sospecha', () => {
    const r = evaluateLivenessSequence(secuencia([null, null, null, null]), 'blink');
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_face');
    expect(r.frames).toBe(0);
    expect(r.framesLost).toBe(4);
    expect(r.score).toBe(0);
  });

  it('perder el rostro a mitad del gesto reinicia el progreso, no lo aprueba', () => {
    // abierto → cerrado → SE PIERDE → abierto. Sin el hueco esto sería un ciclo
    // completo; con el hueco no hay continuidad que respalde el gesto.
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        null,
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(false);
    expect(r.frames).toBe(4);
    expect(r.framesLost).toBe(1);
  });

  it('un ciclo completo DESPUÉS de recuperar el rostro sí vale', () => {
    const r = evaluateLivenessSequence(
      secuencia([
        cara(OJO_ABIERTO, BOCA_CERRADA),
        null,
        cara(OJO_ABIERTO, BOCA_CERRADA),
        cara(OJO_CERRADO, BOCA_CERRADA),
        cara(OJO_ABIERTO, BOCA_CERRADA),
      ]),
      'blink',
    );
    expect(r.passed).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.framesLost).toBe(1);
  });

  it('un arreglo de landmarks incompleto cuenta como rostro perdido', () => {
    // El detector puede devolver una forma inesperada; leerla como cara daría
    // NaN y un veredicto inventado.
    const r = evaluateLivenessSequence(
      secuencia([cara(OJO_ABIERTO, BOCA_CERRADA).slice(0, 40), cara(OJO_ABIERTO, BOCA_CERRADA)]),
      'blink',
    );
    expect(r.framesLost).toBe(1);
    expect(r.frames).toBe(1);
  });

  it('una secuencia vacía no explota', () => {
    const r = evaluateLivenessSequence([], 'blink');
    expect(r.passed).toBe(false);
    expect(r.reason).toBe('no_face');
    expect(r.durationMs).toBe(0);
    expect(r.score).toBe(0);
  });
});
