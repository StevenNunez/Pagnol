import { describe, it, expect } from 'vitest';
import {
    evaluarToma, promediarTomas, evaluarSeparacion,
    MIN_FACE_RATIO_ENROLL, MIN_FACE_RATIO_VERIFY, MAX_SAMPLE_SPREAD,
} from './enrollment-quality';

const euclid = (a: number[], b: number[]) =>
    Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));

const ENCUADRE = { width: 640, height: 480 };

describe('evaluarToma', () => {
    it('acepta un rostro grande y bien detectado', () => {
        const r = evaluarToma({ width: 200, height: 200 }, ENCUADRE, 0.9);
        expect(r.ok).toBe(true);
        expect(r.proporcion).toBeCloseTo(0.3125, 3);
    });

    it('el caso que duele en faena: hay cara pero está lejos → dice "acércate", no falla en silencio', () => {
        // Un rostro de 60px en un encuadre de 640 = 9%: el trabajador parado
        // lejos de la tablet, que hoy termina en "no se detectó ningún rostro".
        const r = evaluarToma({ width: 60, height: 60 }, ENCUADRE, 0.9);
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe('cara_lejos');
        expect(r.mensaje).toMatch(/acércate/i);
    });

    it('poca confianza del detector se distingue de "está lejos"', () => {
        const r = evaluarToma({ width: 300, height: 300 }, ENCUADRE, 0.3);
        expect(r.ok).toBe(false);
        expect(r.motivo).toBe('poca_confianza');
        expect(r.mensaje).toMatch(/luz|frente/i);
    });

    it('verificar es más permisivo que enrolar: el trabajador está de paso', () => {
        const caja = { width: 64, height: 64 }; // 10% del encuadre
        expect(evaluarToma(caja, ENCUADRE, 0.9, MIN_FACE_RATIO_ENROLL).ok).toBe(false);
        expect(evaluarToma(caja, ENCUADRE, 0.9, MIN_FACE_RATIO_VERIFY).ok).toBe(true);
    });

    it('un encuadre de ancho cero no rompe la división', () => {
        const r = evaluarToma({ width: 100, height: 100 }, { width: 0, height: 0 }, 0.9);
        expect(r.ok).toBe(false);
        expect(r.proporcion).toBe(0);
    });
});

describe('promediarTomas', () => {
    it('promedia tomas parecidas en un solo template', () => {
        const r = promediarTomas([[0, 0, 0], [0.2, 0, 0], [0.1, 0, 0]], euclid);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.template[0]).toBeCloseTo(0.1, 5);
    });

    it('RECHAZA tomas de personas distintas: promediarlas daría un template de nadie', () => {
        // Dos descriptores separados muy por encima del umbral de identidad:
        // no son la misma persona, y su promedio no identificaría a ninguna.
        const r = promediarTomas([[0, 0, 0], [0, 0, 0], [1.5, 0, 0]], euclid);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.motivo).toBe('tomas_inconsistentes');
            expect(r.dispersion).toBeGreaterThan(MAX_SAMPLE_SPREAD);
            expect(r.mensaje).toMatch(/quieto|repite/i);
        }
    });

    it('una sola toma pasa (no hay con qué compararla), con dispersión cero', () => {
        const r = promediarTomas([[1, 2, 3]], euclid);
        expect(r.ok).toBe(true);
        if (r.ok) { expect(r.template).toEqual([1, 2, 3]); expect(r.dispersion).toBe(0); }
    });

    it('sin ninguna toma válida no inventa un template', () => {
        const r = promediarTomas([], euclid);
        expect(r.ok).toBe(false);
    });

    it('el promedio conserva el largo del descriptor', () => {
        const a = new Array(128).fill(0.1);
        const b = new Array(128).fill(0.12);
        const r = promediarTomas([a, b], euclid);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.template).toHaveLength(128);
    });
});

describe('evaluarSeparacion', () => {
    const UMBRAL = 0.5;

    it('el caso real de Valar: dos personas a 0,500 son confundibles', () => {
        expect(evaluarSeparacion(0.499, UMBRAL)).toBe('confundible');
    });

    it('justo en el umbral todavía no es "bien"', () => {
        expect(evaluarSeparacion(0.500, UMBRAL)).toBe('margen_estrecho');
        expect(evaluarSeparacion(0.559, UMBRAL)).toBe('margen_estrecho'); // la mediana de Valar
    });

    it('bien separado', () => {
        expect(evaluarSeparacion(0.733, UMBRAL)).toBe('bien'); // el mejor de Valar
    });
});
