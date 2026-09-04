import { describe, it, expect } from 'vitest';
import { construirCurvaS, spiALaFecha, montosALaFecha } from './construction-scurve';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
const HOY = d(2026, 9, 10);

describe('construirCurvaS', () => {
    it('reparte el monto planificado entre los días de la partida', () => {
        // 10 días × $100/día = $1.000
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 10) }],
            [],
            HOY,
        );
        expect(puntos[0].planificado).toBe(100);            // primer día
        expect(puntos[puntos.length - 1].planificado).toBe(1000); // acumulado final
    });

    it('acumula el avance real en la fecha en que se registró, sin repartirlo', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 10) }],
            [{ workItemId: 'a', date: d(2026, 9, 3), quantity: 4 }],
            HOY,
        );
        const alDia3 = puntos.find(p => p.fecha.getTime() === d(2026, 9, 3).getTime())!;
        expect(alDia3.real).toBe(400); // 4 unidades × $100
    });

    it('el tramo futuro deja el real en null: la línea se corta, no cae a cero', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 12, 1) }],
            [{ workItemId: 'a', date: d(2026, 9, 5), quantity: 2 }],
            HOY,
        );
        const futuros = puntos.filter(p => p.fecha.getTime() > HOY.getTime());
        expect(futuros.length).toBeGreaterThan(0);
        expect(futuros.every(p => p.real === null)).toBe(true);
        // …y los planificados a futuro sí siguen subiendo
        expect(futuros[futuros.length - 1].planificado).toBeGreaterThan(futuros[0].planificado);
    });

    it('pondera por monto: una partida cara pesa más que una barata con más cantidad', () => {
        const puntos = construirCurvaS(
            [
                { id: 'cable', quantity: 35000, unitPrice: 10, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 2) },   // $350.000
                { id: 'hormigon', quantity: 100, unitPrice: 10000, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 2) }, // $1.000.000
            ],
            [],
            HOY,
        );
        expect(puntos[puntos.length - 1].planificado).toBe(1_350_000);
    });

    it('una partida sin fechas no inventa calendario, pero tampoco rompe la curva', () => {
        const puntos = construirCurvaS(
            [
                { id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 5) },
                { id: 'sinFechas', quantity: 99, unitPrice: 999 },
            ],
            [],
            HOY,
        );
        expect(puntos[puntos.length - 1].planificado).toBe(1000); // sólo la que sí tiene fechas
    });

    it('sin fechas ni avances devuelve una curva vacía, no una línea plana falsa', () => {
        expect(construirCurvaS([{ id: 'a', quantity: 1, unitPrice: 1 }], [], HOY)).toEqual([]);
    });

    it('una obra larga se muestrea: no devuelve un punto por día', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 1, unitPrice: 1000, plannedStartDate: d(2026, 1, 1), plannedEndDate: d(2027, 12, 31) }],
            [],
            HOY,
        );
        expect(puntos.length).toBeLessThanOrEqual(61); // ~730 días → acotado
        expect(puntos.length).toBeGreaterThan(10);
    });

    it('la hora del día no corre la curva (desfase de zona horaria)', () => {
        const item = [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 10) }];
        const avance = [{ workItemId: 'a', date: new Date(2026, 8, 3, 23, 50), quantity: 4 }];
        const a = construirCurvaS(item, avance, HOY);
        const b = construirCurvaS(item, [{ workItemId: 'a', date: new Date(2026, 8, 3, 0, 10), quantity: 4 }], HOY);
        expect(a.map(p => p.real)).toEqual(b.map(p => p.real));
    });
});

describe('spiALaFecha', () => {
    it('atrasado: se ejecutó menos de lo planificado', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 10) }],
            [{ workItemId: 'a', date: d(2026, 9, 2), quantity: 2 }], // $200 de $1.000 planificados al día 10
            HOY,
        );
        const spi = spiALaFecha(puntos, HOY)!;
        expect(spi).toBeLessThan(1);
        expect(spi).toBeCloseTo(0.2, 2);
    });

    it('a tiempo: ejecutado igual a lo planificado', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 9, 10) }],
            [{ workItemId: 'a', date: d(2026, 9, 5), quantity: 10 }],
            HOY,
        );
        expect(spiALaFecha(puntos, HOY)).toBeCloseTo(1, 2);
    });

    it('sin nada planificado todavía devuelve null, no "infinitamente adelantado"', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 10, unitPrice: 100, plannedStartDate: d(2026, 12, 1), plannedEndDate: d(2026, 12, 10) }],
            [],
            HOY,
        );
        expect(spiALaFecha(puntos, HOY)).toBeNull();
    });
});

describe('montosALaFecha', () => {
    it('devuelve el acumulado de hoy, no el del final de la obra', () => {
        const puntos = construirCurvaS(
            [{ id: 'a', quantity: 100, unitPrice: 100, plannedStartDate: d(2026, 9, 1), plannedEndDate: d(2026, 12, 1) }],
            [{ workItemId: 'a', date: d(2026, 9, 5), quantity: 10 }],
            HOY,
        );
        const m = montosALaFecha(puntos, HOY);
        expect(m.real).toBe(1000);
        expect(m.planificado).toBeGreaterThan(0);
        expect(m.planificado).toBeLessThan(10000); // no el total de la obra
    });

    it('curva vacía no rompe: devuelve ceros', () => {
        expect(montosALaFecha([], HOY)).toEqual({ planificado: 0, real: 0 });
    });
});
