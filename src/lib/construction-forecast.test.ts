import { describe, it, expect } from 'vitest';
import { forecastCompletion, activityBucket, overdueDays, rollupProgress } from './construction-forecast';

// Fecha fija para que los tests no dependan de cuándo se corren.
const HOY = new Date(2026, 8, 2); // 2 de septiembre de 2026 (mes 0-based)
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe('forecastCompletion', () => {
    it('proyecta al ritmo real: 50% en 10 días → otros 10 días', () => {
        const f = forecastCompletion(
            { progress: 50, firstProgressDate: d(2026, 8, 23) }, // 10 días antes
            HOY,
        );
        expect(f.kind).toBe('projected');
        expect(f.date).toEqual(d(2026, 9, 12));
    });

    it('un ritmo lento proyecta más lejos que la fecha planificada, y lo reporta como atraso', () => {
        const f = forecastCompletion(
            {
                progress: 25,
                firstProgressDate: d(2026, 8, 3), // 30 días → 0,833%/día
                plannedEndDate: d(2026, 9, 30),
            },
            HOY,
        );
        expect(f.kind).toBe('projected');
        // faltan 75% a 0,833%/día = 90 días
        expect(f.date).toEqual(d(2026, 12, 1));
        expect(f.deviationDays).toBe(62);
    });

    it('un ritmo rápido proyecta antes del plan: la desviación es negativa', () => {
        const f = forecastCompletion(
            { progress: 80, firstProgressDate: d(2026, 8, 29), plannedEndDate: d(2026, 9, 30) },
            HOY,
        );
        expect(f.kind).toBe('projected');
        expect(f.deviationDays).toBeLessThan(0);
    });

    it('sin avance todavía: cae a la fecha planificada y NO inventa una proyección', () => {
        const f = forecastCompletion({ progress: 0, plannedEndDate: d(2026, 10, 15) }, HOY);
        expect(f.kind).toBe('planned');
        expect(f.date).toEqual(d(2026, 10, 15));
        expect(f.deviationDays).toBeNull();
    });

    it('sin avance y sin plan: no devuelve fecha alguna', () => {
        const f = forecastCompletion({ progress: 0 }, HOY);
        expect(f.kind).toBe('unknown');
        expect(f.date).toBeNull();
    });

    it('con avance pero sin fecha de inicio de ningún tipo: no se puede medir ritmo', () => {
        const f = forecastCompletion({ progress: 40, plannedEndDate: d(2026, 10, 1) }, HOY);
        expect(f.kind).toBe('planned');
    });

    it('mide el ritmo desde el inicio REAL, no desde el planificado', () => {
        // Empezó 10 días tarde. Desde el inicio real lleva 10 días para un 50%,
        // así que le faltan otros 10. Desde el planificado parecerían 20 días
        // para un 50% → proyectaría 20 más, una fecha peor que la real.
        const real = forecastCompletion(
            { progress: 50, plannedStartDate: d(2026, 8, 13), firstProgressDate: d(2026, 8, 23) },
            HOY,
        );
        expect(real.date).toEqual(d(2026, 9, 12));
    });

    it('un avance de hoy mismo no divide por cero', () => {
        const f = forecastCompletion({ progress: 10, firstProgressDate: HOY }, HOY);
        expect(f.kind).toBe('projected');
        expect(Number.isFinite(f.date!.getTime())).toBe(true);
        expect(f.date).toEqual(d(2026, 9, 11)); // 90% restante a 10%/día
    });

    it('un ritmo absurdamente lento no muestra una fecha ridícula: cae al plan', () => {
        const f = forecastCompletion(
            { progress: 0.5, firstProgressDate: d(2026, 6, 2), plannedEndDate: d(2026, 10, 1) },
            HOY,
        );
        expect(f.kind).toBe('planned');
        expect(f.date).toEqual(d(2026, 10, 1));
    });

    it('una partida terminada no se proyecta', () => {
        const f = forecastCompletion(
            { progress: 100, firstProgressDate: d(2026, 8, 1), plannedEndDate: d(2026, 9, 30) },
            HOY,
        );
        expect(f.kind).toBe('planned');
    });

    it('la hora del día no corre la proyección un día (desfase de zona horaria)', () => {
        const tarde = new Date(2026, 8, 2, 23, 45);
        const temprano = new Date(2026, 8, 2, 0, 15);
        const a = forecastCompletion({ progress: 50, firstProgressDate: d(2026, 8, 23) }, tarde);
        const b = forecastCompletion({ progress: 50, firstProgressDate: d(2026, 8, 23) }, temprano);
        expect(a.date).toEqual(b.date);
    });

    it('reporta con cuántos días de historia se hizo la proyección', () => {
        const diezDias = forecastCompletion({ progress: 50, firstProgressDate: d(2026, 8, 23) }, HOY);
        expect(diezDias.basisDays).toBe(10);

        // El caso frágil: todo el avance se registró hoy. La cuenta da mañana,
        // y la pantalla tiene que poder decir que se apoya en un solo día.
        const unDia = forecastCompletion({ progress: 80, firstProgressDate: HOY }, HOY);
        expect(unDia.kind).toBe('projected');
        expect(unDia.basisDays).toBe(1);
        expect(unDia.date).toEqual(d(2026, 9, 3));
    });

    it('cuando no hay proyección no hay base que reportar', () => {
        expect(forecastCompletion({ progress: 0, plannedEndDate: d(2026, 10, 1) }, HOY).basisDays).toBeNull();
    });
});

describe('activityBucket', () => {
    it('separa por estado y avance', () => {
        expect(activityBucket({ status: 'in-progress', progress: 0 })).toBe('notStarted');
        expect(activityBucket({ status: 'in-progress', progress: 35 })).toBe('running');
        expect(activityBucket({ status: 'pending-quality-review', progress: 100 })).toBe('pending');
        expect(activityBucket({ status: 'rejected', progress: 80 })).toBe('rejected');
        expect(activityBucket({ status: 'completed', progress: 100 })).toBe('done');
    });

    it('un 100% sin aprobar todavía cuenta como terminado, no como en ejecución', () => {
        expect(activityBucket({ status: 'in-progress', progress: 100 })).toBe('done');
    });
});

describe('overdueDays', () => {
    it('cuenta los días desde que venció', () => {
        expect(overdueDays({ progress: 40, plannedEndDate: d(2026, 8, 28) }, HOY)).toBe(5);
    });

    it('lo que vence en el futuro no es atraso', () => {
        expect(overdueDays({ progress: 40, plannedEndDate: d(2026, 9, 30) }, HOY)).toBe(0);
    });

    it('una partida terminada no arrastra atraso', () => {
        expect(overdueDays({ progress: 100, plannedEndDate: d(2026, 8, 1) }, HOY)).toBe(0);
    });

    it('sin fecha planificada no hay atraso que medir', () => {
        expect(overdueDays({ progress: 10 }, HOY)).toBe(0);
    });
});

describe('rollupProgress', () => {
    it('pondera por monto, no por cantidad', () => {
        // El caso real de la obra de ejemplo: una partida barata con una
        // cantidad enorme (cable) contra una cara con cantidad chica (hormigón).
        const partidas = [
            { quantity: 35000, unitPrice: 7900, progress: 100 },  // $276,5M al 100%
            { quantity: 950, unitPrice: 128000, progress: 0 },    // $121,6M al 0%
        ];
        // Por monto: 276,5 / 398,1 = 69,5%. Por cantidad daría 97,4%.
        expect(rollupProgress(partidas)).toBeCloseTo(69.46, 1);
    });

    it('sin precios cargados cae a la ponderación por cantidad', () => {
        const partidas = [
            { quantity: 300, unitPrice: 0, progress: 100 },
            { quantity: 100, unitPrice: 0, progress: 0 },
        ];
        expect(rollupProgress(partidas)).toBe(75);
    });

    it('sin precios ni cantidades, promedio simple', () => {
        expect(rollupProgress([{ progress: 80 }, { progress: 20 }])).toBe(50);
    });

    it('una obra sin partidas es 0%, no NaN', () => {
        expect(rollupProgress([])).toBe(0);
    });

    it('una partida con precio y otra sin él no descarta la que sí tiene', () => {
        const r = rollupProgress([
            { quantity: 10, unitPrice: 1000, progress: 100 },
            { quantity: 10, unitPrice: 0, progress: 0 },
        ]);
        expect(r).toBe(100); // la sin precio no aporta monto, no puede diluir
    });
});
