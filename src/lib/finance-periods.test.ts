import { describe, expect, it } from 'vitest';
import { closedMonthsFromEvents, splitByClosedPeriod } from './finance-periods';

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
