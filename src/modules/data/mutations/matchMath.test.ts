import { describe, it, expect } from 'vitest';
import {
  AMBIGUITY_MARGIN,
  DESCRIPTOR_LENGTH,
  MATCH_THRESHOLD,
  euclideanDistance,
  findBestMatch,
  parseDescriptor,
  verifyAgainst,
} from './matchMath';

/** Descriptor de 128 posiciones, todas iguales, para construir casos a distancia conocida. */
const vector = (valor: number): number[] => Array(DESCRIPTOR_LENGTH).fill(valor);

/**
 * Devuelve un descriptor cuya distancia euclidiana a `vector(0)` es `d`.
 *
 * Toda la diferencia va en UNA componente a propósito: así la distancia es
 * sqrt(d²) = d, exacta en coma flotante para los valores representables. La
 * versión anterior repartía `d` entre las 128 componentes y el redondeo hacía
 * que "exactamente 0,5" llegara como 0,49999…, rompiendo las pruebas de límite
 * — que son justamente las que importan cuando el umbral es `<` y no `<=`.
 */
const aDistancia = (d: number): number[] => {
  const v = vector(0);
  v[0] = d;
  return v;
};

const template = (v: number[]): string => JSON.stringify(v);

describe('parseDescriptor', () => {
  it('acepta un template bien formado', () => {
    expect(parseDescriptor(template(vector(0.1)))).toHaveLength(DESCRIPTOR_LENGTH);
  });

  it('rechaza null, vacío y basura sin lanzar', () => {
    expect(parseDescriptor(null)).toBeNull();
    expect(parseDescriptor(undefined)).toBeNull();
    expect(parseDescriptor('')).toBeNull();
    expect(parseDescriptor('no soy json')).toBeNull();
    expect(parseDescriptor('{"a":1}')).toBeNull();
  });

  it('rechaza un descriptor de largo equivocado', () => {
    expect(parseDescriptor(JSON.stringify([1, 2, 3]))).toBeNull();
    expect(parseDescriptor(JSON.stringify(Array(127).fill(0)))).toBeNull();
  });

  it('rechaza vectores con NaN o no-números — comparar contra eso daría NaN', () => {
    const conNaN = vector(0.1);
    conNaN[7] = NaN;
    expect(parseDescriptor(JSON.stringify(conNaN))).toBeNull();

    const conTexto = vector(0.1) as unknown[];
    conTexto[7] = '0.1';
    expect(parseDescriptor(JSON.stringify(conTexto))).toBeNull();
  });
});

describe('euclideanDistance', () => {
  it('da 0 contra sí mismo', () => {
    expect(euclideanDistance(vector(0.3), vector(0.3))).toBe(0);
  });

  it('reproduce la distancia construida', () => {
    expect(euclideanDistance(vector(0), aDistancia(0.427))).toBeCloseTo(0.427, 10);
    expect(euclideanDistance(vector(0), aDistancia(0.72))).toBeCloseTo(0.72, 10);
  });

  it('es simétrica', () => {
    const a = aDistancia(0.4);
    const b = aDistancia(0.9);
    expect(euclideanDistance(a, b)).toBeCloseTo(euclideanDistance(b, a), 12);
  });

  it('lanza si los largos no coinciden — comparar peras con manzanas no es un 0', () => {
    expect(() => euclideanDistance([1, 2], [1, 2, 3])).toThrow();
  });
});

describe('verifyAgainst (1:1)', () => {
  const yo = vector(0);

  it('acepta a la misma persona con la distancia intra-persona real medida (0,427)', () => {
    const r = verifyAgainst(yo, template(aDistancia(0.427)));
    expect(r.matched).toBe(true);
    expect(r.reason).toBe('ok');
    expect(r.distance).toBeCloseTo(0.427, 6);
    expect(r.threshold).toBe(MATCH_THRESHOLD);
  });

  it('rechaza a otra persona con la distancia inter-persona real medida (0,72)', () => {
    const r = verifyAgainst(yo, template(aDistancia(0.72)));
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no_match');
  });

  it('el umbral es estrictamente menor: justo en el umbral NO pasa', () => {
    const r = verifyAgainst(yo, template(aDistancia(MATCH_THRESHOLD)));
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no_match');
  });

  it('sin template enrolado dice "empty", no "no coincide"', () => {
    // La distinción importa: "no coincide" acusaría de impostor a quien
    // simplemente nunca fue enrolado.
    const r = verifyAgainst(yo, null);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('empty');
    expect(r.distance).toBeNull();
  });

  it('con template corrupto dice "empty", tampoco "no coincide"', () => {
    expect(verifyAgainst(yo, 'basura').reason).toBe('empty');
  });

  it('con descriptor vivo mal formado dice "bad_input"', () => {
    expect(verifyAgainst(null, template(vector(0))).reason).toBe('bad_input');
    expect(verifyAgainst([1, 2, 3], template(vector(0))).reason).toBe('bad_input');
  });

  it('respeta un umbral distinto al por defecto', () => {
    const r = verifyAgainst(yo, template(aDistancia(0.55)), 0.6);
    expect(r.matched).toBe(true);
    expect(r.threshold).toBe(0.6);
  });
});

describe('findBestMatch (1:N)', () => {
  const yo = vector(0);

  it('identifica al más cercano cuando está claramente separado', () => {
    const r = findBestMatch(yo, [
      { userId: 'lejano', template: template(aDistancia(0.80)) },
      { userId: 'yo', template: template(aDistancia(0.30)) },
      { userId: 'medio', template: template(aDistancia(0.65)) },
    ]);
    expect(r.matched).toBe(true);
    expect(r.userId).toBe('yo');
    expect(r.distance).toBeCloseTo(0.30, 6);
    expect(r.runnerUpDistance).toBeCloseTo(0.65, 6);
    expect(r.evaluated).toBe(3);
  });

  it('el segundo mejor es el segundo, no el último visto', () => {
    // Orden adverso a propósito: el más cercano llega al medio.
    const r = findBestMatch(yo, [
      { userId: 'a', template: template(aDistancia(0.90)) },
      { userId: 'b', template: template(aDistancia(0.20)) },
      { userId: 'c', template: template(aDistancia(0.45)) },
    ]);
    expect(r.userId).toBe('b');
    expect(r.runnerUpDistance).toBeCloseTo(0.45, 6);
  });

  it('no identifica a nadie si el mejor no baja del umbral', () => {
    const r = findBestMatch(yo, [
      { userId: 'a', template: template(aDistancia(0.72)) },
      { userId: 'b', template: template(aDistancia(0.75)) },
    ]);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('no_match');
    expect(r.userId).toBeNull();
    // Aun sin identificar, la distancia se devuelve: es la evidencia del intento.
    expect(r.distance).toBeCloseTo(0.72, 6);
  });

  it('declara ambigüedad cuando dos candidatos empatan dentro del margen', () => {
    // El caso real del tenant: dos enrolamientos de LA MISMA cara (Steven y el
    // usuario de prueba Picapiedra). Elegir uno sería lanzar una moneda sobre
    // quién queda como responsable del activo.
    const r = findBestMatch(yo, [
      { userId: 'steven', template: template(aDistancia(0.30)) },
      { userId: 'picapiedra', template: template(aDistancia(0.30 + AMBIGUITY_MARGIN / 2)) },
    ]);
    expect(r.matched).toBe(false);
    expect(r.reason).toBe('ambiguous');
    // Se informa quién iba ganando: sirve para diagnosticar el duplicado.
    expect(r.userId).toBe('steven');
    expect(r.runnerUpDistance).not.toBeNull();
  });

  it('separado por más del margen NO es ambiguo', () => {
    const r = findBestMatch(yo, [
      { userId: 'a', template: template(aDistancia(0.30)) },
      { userId: 'b', template: template(aDistancia(0.30 + AMBIGUITY_MARGIN * 2)) },
    ]);
    expect(r.matched).toBe(true);
    expect(r.reason).toBe('ok');
  });

  it('la ambigüedad sólo aplica al que ya pasó el umbral', () => {
    // Dos desconocidos empatados no son "ambiguos": son simplemente nadie.
    const r = findBestMatch(yo, [
      { userId: 'a', template: template(aDistancia(0.80)) },
      { userId: 'b', template: template(aDistancia(0.801)) },
    ]);
    expect(r.reason).toBe('no_match');
  });

  it('un candidato solo nunca es ambiguo y no tiene segundo', () => {
    const r = findBestMatch(yo, [{ userId: 'unico', template: template(aDistancia(0.30)) }]);
    expect(r.matched).toBe(true);
    expect(r.runnerUpDistance).toBeNull();
  });

  it('un template corrupto se salta sin tumbar la búsqueda', () => {
    // Un enrolamiento roto de UNA persona no puede dejar sin identificar a toda
    // la faena.
    const r = findBestMatch(yo, [
      { userId: 'roto', template: 'no soy json' },
      { userId: 'yo', template: template(aDistancia(0.30)) },
    ]);
    expect(r.matched).toBe(true);
    expect(r.userId).toBe('yo');
    expect(r.evaluated).toBe(1);
  });

  it('padrón vacío o íntegramente ilegible dice "empty"', () => {
    expect(findBestMatch(yo, []).reason).toBe('empty');
    expect(findBestMatch(yo, [{ userId: 'x', template: '' }]).reason).toBe('empty');
  });

  it('con descriptor vivo mal formado dice "bad_input" y no compara nada', () => {
    const r = findBestMatch(null, [{ userId: 'a', template: template(vector(0)) }]);
    expect(r.reason).toBe('bad_input');
    expect(r.evaluated).toBe(0);
  });

  it('escenario completo con los tres números medidos en producción', () => {
    // Rostro vivo de Steven contra un padrón donde él está a su distancia
    // intra-persona real y los demás a la inter-persona real.
    const r = findBestMatch(yo, [
      { userId: 'german', template: template(aDistancia(0.73)) },
      { userId: 'steven', template: template(aDistancia(0.427)) },
      { userId: 'javier', template: template(aDistancia(0.72)) },
    ]);
    expect(r.matched).toBe(true);
    expect(r.userId).toBe('steven');
    expect(r.distance).toBeCloseTo(0.427, 6);
    expect(r.runnerUpDistance).toBeCloseTo(0.72, 6);
    // La separación real (0,29) es 14 veces el margen de ambigüedad: el margen
    // no estorba en operación normal.
    expect(r.runnerUpDistance! - r.distance!).toBeGreaterThan(AMBIGUITY_MARGIN * 10);
  });
});
