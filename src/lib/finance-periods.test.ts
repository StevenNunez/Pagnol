import { describe, expect, it } from 'vitest';
import {
    closedMonthsFromEvents, splitByClosedPeriod, splitByLiquidatedMonth,
} from './finance-periods';

// Cierre de período (F4.1). Estas dos funciones son la regla compartida entre la
// UI, los crons y —en su versión SQL— el guard de la base: si divergen, el panel
// mostraría un mes como abierto mientras el ledger lo rechaza.

const ev = (period_month: string, action: string) => ({ period_month, action });

describe('closedMonthsFromEvents', () => {
    it('un mes con solo cierre queda cerrado', () => {
        expect([...closedMonthsFromEvents([ev('2026-01-01', 'close')])]).toEqual(['2026-01']);
    });

    it('reabrir deja el mes abierto (vale el último evento)', () => {
        // Los eventos llegan del más reciente al más antiguo.
        const closed = closedMonthsFromEvents([
            ev('2026-01-01', 'reopen'),
            ev('2026-01-01', 'close'),
        ]);
        expect(closed.has('2026-01')).toBe(false);
    });

    it('cerrar → reabrir → cerrar vuelve a cerrarlo, sin perder el historial', () => {
        const events = [
            ev('2026-01-01', 'close'),
            ev('2026-01-01', 'reopen'),
            ev('2026-01-01', 'close'),
        ];
        expect(closedMonthsFromEvents(events).has('2026-01')).toBe(true);
        expect(events).toHaveLength(3); // append-only: nada se borró
    });

    it('cada mes es independiente', () => {
        const closed = closedMonthsFromEvents([
            ev('2026-02-01', 'reopen'),
            ev('2026-02-01', 'close'),
            ev('2026-01-01', 'close'),
        ]);
        expect([...closed]).toEqual(['2026-01']);
    });

    it('sin eventos no hay meses cerrados', () => {
        expect(closedMonthsFromEvents([]).size).toBe(0);
    });
});

describe('splitByClosedPeriod', () => {
    const row = (entry_date: string, tag: string) => ({ entry_date, tag });

    it('aparta solo las filas del mes cerrado y reporta el mes', () => {
        const { insertable, blocked, blockedMonths } = splitByClosedPeriod(
            [row('2026-01-28', 'MO enero'), row('2026-02-03', 'MO febrero')],
            new Set(['2026-01']),
        );
        expect(insertable.map((r) => r.tag)).toEqual(['MO febrero']);
        expect(blocked.map((r) => r.tag)).toEqual(['MO enero']);
        expect(blockedMonths).toEqual(['2026-01']);
    });

    it('sin meses cerrados pasa todo (comportamiento previo a F4.1 intacto)', () => {
        const rows = [row('2026-01-28', 'a'), row('2026-02-03', 'b')];
        const { insertable, blocked } = splitByClosedPeriod(rows, new Set());
        expect(insertable).toHaveLength(2);
        expect(blocked).toHaveLength(0);
    });

    it('una sola fila bloqueada NO arrastra al resto del lote', () => {
        // El motivo de existir de esta función: el INSERT va en lotes de 500 y el
        // trigger aborta el lote entero si una fila cae en período cerrado.
        const rows = Array.from({ length: 10 }, (_, i) =>
            row(i === 4 ? '2026-01-15' : '2026-02-15', `r${i}`));
        const { insertable, blocked } = splitByClosedPeriod(rows, new Set(['2026-01']));
        expect(insertable).toHaveLength(9);
        expect(blocked).toHaveLength(1);
    });

    it('reporta cada mes cerrado afectado, ordenado', () => {
        const { blockedMonths } = splitByClosedPeriod(
            [row('2026-03-01', 'c'), row('2026-01-01', 'a'), row('2026-02-01', 'b')],
            new Set(['2026-01', '2026-02', '2026-03']),
        );
        expect(blockedMonths).toEqual(['2026-01', '2026-02', '2026-03']);
    });
});

// ── F4 / ADR-010: el blindaje contra la duplicación ──────────────────────────
// Sin esto, cerrar la planilla de julio el 1 de agosto deja esos días dentro de
// la ventana de 35 días del cron, que al día siguiente revive la estimación: el
// mes quedaría con costo estimado + real y el margen mentiría a diario.

const dia = (userId: string, date: string) => ({ source_id: `${userId}:${date}` });

describe('splitByLiquidatedMonth', () => {
    it('aparta los días de un mes con planilla cerrada', () => {
        const { insertable, skipped, skippedMonths } = splitByLiquidatedMonth(
            [dia('u1', '2026-07-14'), dia('u1', '2026-08-02')],
            new Set(['2026-07']),
        );
        expect(skipped).toHaveLength(1);
        expect(insertable).toHaveLength(1);
        expect(skippedMonths).toEqual(['2026-07']);
    });

    it('usa el DÍA TRABAJADO del source_id, no la fecha de emisión', () => {
        // Un hecho reconciliado se emite otro día, pero su source_id conserva el
        // día trabajado: es ese el que decide si el mes está liquidado.
        const { skipped } = splitByLiquidatedMonth([dia('u1', '2026-07-31')], new Set(['2026-07']));
        expect(skipped).toHaveLength(1);
    });

    it('sin meses liquidados devuelve todo tal cual (sin copiar de más)', () => {
        const rows = [dia('u1', '2026-07-14')];
        const out = splitByLiquidatedMonth(rows, new Set());
        expect(out.insertable).toBe(rows);
        expect(out.skipped).toHaveLength(0);
    });

    it('un source_id con formato inesperado NO se aparta (no se pierde el hecho)', () => {
        const { insertable, skipped } = splitByLiquidatedMonth(
            [{ source_id: 'raro' }, { source_id: null }],
            new Set(['2026-07']),
        );
        expect(insertable).toHaveLength(2);
        expect(skipped).toHaveLength(0);
    });

    it('reporta todos los meses liquidados que tocó, ordenados', () => {
        const { skippedMonths } = splitByLiquidatedMonth(
            [dia('u1', '2026-08-03'), dia('u1', '2026-06-10'), dia('u2', '2026-07-01')],
            new Set(['2026-06', '2026-07', '2026-08']),
        );
        expect(skippedMonths).toEqual(['2026-06', '2026-07', '2026-08']);
    });
});
