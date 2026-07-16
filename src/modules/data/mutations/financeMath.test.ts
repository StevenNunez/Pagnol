import { describe, expect, it } from 'vitest';
import {
    DEFAULT_TAX_RATE, buildEntryRow, netFromGross, toClp,
    laborDayCost, laborDaySourceId, parseLaborSourceId, laborDayPresence, laborDayExpected,
    reconcileLaborDay,
    type FinanceEntryInput, type LaborDayLog, type LaborLiveEntry,
} from './financeMath';

// Matemática de dinero del ledger financiero (F0). CLP se maneja en enteros;
// la convención neto/bruto y el congelado de tasa son la base de todo el dominio
// — si esto se rompe, TODOS los hechos nacen mal.

describe('netFromGross', () => {
    it('deriva el neto de un bruto con IVA 19% (convención facturas F0)', () => {
        expect(netFromGross(119_000)).toBe(100_000);
        expect(netFromGross(1_190)).toBe(1_000);
    });

    it('redondea a peso entero', () => {
        // 100 / 1.19 = 84.0336…
        expect(netFromGross(100)).toBe(84);
    });

    it('soporta tasas distintas y exentas', () => {
        expect(netFromGross(110_000, 10)).toBe(100_000);
        expect(netFromGross(50_000, 0)).toBe(50_000);
    });

    it('devuelve 0 para montos inválidos o cero', () => {
        expect(netFromGross(0)).toBe(0);
        expect(netFromGross(NaN)).toBe(0);
        expect(netFromGross(Infinity)).toBe(0);
    });

    it('la tasa por defecto es el IVA chileno', () => {
        expect(DEFAULT_TAX_RATE).toBe(19);
    });
});

describe('toClp', () => {
    it('convierte moneda origen a CLP con la tasa del día', () => {
        expect(toClp(100, 37_500.5)).toBe(3_750_050); // 100 UF
        expect(toClp(1, 1)).toBe(1);                  // CLP → CLP
    });

    it('devuelve 0 ante entradas inválidas', () => {
        expect(toClp(NaN, 37_000)).toBe(0);
        expect(toClp(100, NaN)).toBe(0);
    });
});

describe('buildEntryRow', () => {
    const base: FinanceEntryInput = {
        nature: 'cost',
        stage: 'committed',
        category: 'materials',
        amountNet: 150_000.4,
        sourceType: 'purchase_order',
        sourceId: 'PAG-PUR-0001',
    };

    it('redondea el neto y aplica defaults CLP (moneda, original, fx 1)', () => {
        const row = buildEntryRow(base, 'tenant-1', { id: 'u1', name: 'Steven' });
        expect(row.amount_net).toBe(150_000);
        expect(row.currency).toBe('CLP');
        expect(row.amount_original).toBe(150_000);
        expect(row.fx_rate).toBe(1);
        expect(row.tenant_id).toBe('tenant-1');
    });

    it('todo hecho tiene autor (Art. 5) cuando hay usuario en contexto', () => {
        const row = buildEntryRow(base, 'tenant-1', { id: 'u1', name: 'Steven' });
        expect(row.created_by).toBe('u1');
        expect(row.created_by_name).toBe('Steven');
    });

    it('preserva moneda origen y tasa cuando se indican (UF)', () => {
        const row = buildEntryRow(
            { ...base, currency: 'UF', amountOriginal: 4, fxRate: 37_500, amountNet: toClp(4, 37_500) },
            'tenant-1', null,
        );
        expect(row.currency).toBe('UF');
        expect(row.amount_original).toBe(4);
        expect(row.fx_rate).toBe(37_500);
        expect(row.amount_net).toBe(150_000);
    });

    it('dimensiones ausentes quedan null explícito (sin contrato = dato de calidad visible)', () => {
        const row = buildEntryRow(base, 'tenant-1', null);
        expect(row.contract_id).toBeNull();
        expect(row.work_item_id).toBeNull();
        expect(row.cost_center_id).toBeNull();
        expect(row.reversal_of).toBeNull();
    });

    it('usa la fecha contable indicada y cae a hoy si no viene', () => {
        expect(buildEntryRow({ ...base, entryDate: '2026-07-01' }, 't', null).entry_date).toBe('2026-07-01');
        expect(buildEntryRow(base, 't', null).entry_date).toBe(new Date().toISOString().slice(0, 10));
    });
});

// ─── F1: costo de mano de obra (ADR-003) ─────────────────────────────────────

const inLog = (over: Partial<LaborDayLog> = {}): LaborDayLog => ({
    type: 'in', markType: null, contractId: 'c1', timestamp: '2026-07-10T08:00:00Z', ...over,
});

describe('laborDayCost', () => {
    it('día-persona = sueldo/30 × factor, redondeado a peso', () => {
        expect(laborDayCost(600_000, 1.35)).toBe(27_000);
        // 500000/30 × 1.35 = 22500.0 → ok; 550000/30 × 1.35 = 24750
        expect(laborDayCost(550_000, 1.35)).toBe(24_750);
    });

    it('sin sueldo o factor inválido ⇒ 0 (no se inventa un costo)', () => {
        expect(laborDayCost(0, 1.35)).toBe(0);
        expect(laborDayCost(-1, 1.35)).toBe(0);
        expect(laborDayCost(NaN, 1.35)).toBe(0);
        expect(laborDayCost(600_000, 0)).toBe(0);
        expect(laborDayCost(600_000, NaN)).toBe(0);
    });
});

describe('laborDaySourceId', () => {
    it('codifica y decodifica {userId}:{yyyy-MM-dd}', () => {
        const id = laborDaySourceId('u-123', '2026-07-10');
        expect(id).toBe('u-123:2026-07-10');
        expect(parseLaborSourceId(id)).toEqual({ userId: 'u-123', date: '2026-07-10' });
    });
});

describe('laborDayPresence', () => {
    it('un scan normal de entrada es presencia, con el contrato de la marca', () => {
        expect(laborDayPresence([inLog()])).toEqual({ contractId: 'c1' });
    });

    it('el pareo in/out es para horas: una salida olvidada no borra la presencia', () => {
        expect(laborDayPresence([inLog(), { ...inLog({ type: 'out', timestamp: '2026-07-10T18:00:00Z' }) }])).toEqual({ contractId: 'c1' });
        expect(laborDayPresence([inLog({ type: 'out' })])).toBeNull(); // solo 'out' no es presencia
    });

    it('marcas importadas P/ATR/MJ son presencia; A/D/LM/PSG/V/PP no', () => {
        for (const mark of ['P', 'ATR', 'MJ']) {
            expect(laborDayPresence([inLog({ markType: mark })])).not.toBeNull();
        }
        // el import inserta type='in' para TODAS las marcas, incluidas ausencias
        for (const mark of ['A', 'D', 'LM', 'PSG', 'V', 'PP']) {
            expect(laborDayPresence([inLog({ markType: mark })])).toBeNull();
        }
    });

    it('el contrato del día es el de la PRIMERA marca trabajada', () => {
        expect(laborDayPresence([
            inLog({ contractId: 'c2', timestamp: '2026-07-10T13:00:00Z' }),
            inLog({ contractId: 'c1', timestamp: '2026-07-10T08:00:00Z' }),
        ])).toEqual({ contractId: 'c1' });
    });

    it('sin contrato en la marca ⇒ contractId null (alerta, no se adivina)', () => {
        expect(laborDayPresence([inLog({ contractId: null })])).toEqual({ contractId: null });
    });
});

describe('laborDayExpected', () => {
    it('presencia con sueldo ⇒ hecho esperado', () => {
        expect(laborDayExpected([inLog()], 600_000, 1.35)).toEqual({ amountNet: 27_000, contractId: 'c1' });
    });

    it('sin presencia ⇒ null; presencia sin sueldo ⇒ null (ADR-003 §4)', () => {
        expect(laborDayExpected([], 600_000, 1.35)).toBeNull();
        expect(laborDayExpected([inLog({ markType: 'V' })], 600_000, 1.35)).toBeNull();
        expect(laborDayExpected([inLog()], null, 1.35)).toBeNull();
        expect(laborDayExpected([inLog()], 0, 1.35)).toBeNull();
    });
});

describe('reconcileLaborDay', () => {
    const live = (over: Partial<LaborLiveEntry> = {}): LaborLiveEntry => ({
        id: 'e1', amountNet: 27_000, contractId: 'c1', contractName: 'Contrato 1', ...over,
    });

    it('vivo == esperado ⇒ no-op (idempotencia del cron)', () => {
        expect(reconcileLaborDay({ amountNet: 27_000, contractId: 'c1' }, [live()]))
            .toEqual({ mirrors: [], emit: null });
        expect(reconcileLaborDay(null, [])).toEqual({ mirrors: [], emit: null });
    });

    it('un grupo ya neteado en 0 (hecho + espejo) cuenta como vacío', () => {
        expect(reconcileLaborDay(null, [live(), live({ id: 'e2', amountNet: -27_000 })]))
            .toEqual({ mirrors: [], emit: null });
    });

    it('día nuevo sin hechos ⇒ solo emisión', () => {
        expect(reconcileLaborDay({ amountNet: 27_000, contractId: 'c1' }, []))
            .toEqual({ mirrors: [], emit: { amountNet: 27_000, contractId: 'c1' } });
    });

    it('cambio de sueldo ⇒ espejo del monto viejo + hecho nuevo', () => {
        const r = reconcileLaborDay({ amountNet: 30_000, contractId: 'c1' }, [live()]);
        expect(r.mirrors).toEqual([{ amountNet: -27_000, contractId: 'c1', contractName: 'Contrato 1', reversalOf: 'e1' }]);
        expect(r.emit).toEqual({ amountNet: 30_000, contractId: 'c1' });
    });

    it('cambio de contrato ⇒ reversa el grupo viejo y emite en el nuevo', () => {
        const r = reconcileLaborDay({ amountNet: 27_000, contractId: 'c2' }, [live()]);
        expect(r.mirrors).toHaveLength(1);
        expect(r.mirrors[0].contractId).toBe('c1');
        expect(r.emit).toEqual({ amountNet: 27_000, contractId: 'c2' });
    });

    it('marcas borradas o sueldo retirado ⇒ solo reverso (esperado = ∅)', () => {
        const r = reconcileLaborDay(null, [live()]);
        expect(r.mirrors).toEqual([{ amountNet: -27_000, contractId: 'c1', contractName: 'Contrato 1', reversalOf: 'e1' }]);
        expect(r.emit).toBeNull();
    });

    it('grupos vivos en varios contratos ⇒ un espejo por grupo, anclado al primer hecho', () => {
        const r = reconcileLaborDay({ amountNet: 27_000, contractId: 'c1' }, [
            live(), live({ id: 'e2', contractId: 'c2', contractName: 'Contrato 2', amountNet: 10_000 }),
            live({ id: 'e3', contractId: 'c2', contractName: 'Contrato 2', amountNet: 5_000 }),
        ]);
        expect(r.mirrors).toContainEqual({ amountNet: -27_000, contractId: 'c1', contractName: 'Contrato 1', reversalOf: 'e1' });
        expect(r.mirrors).toContainEqual({ amountNet: -15_000, contractId: 'c2', contractName: 'Contrato 2', reversalOf: 'e2' });
        expect(r.emit).toEqual({ amountNet: 27_000, contractId: 'c1' });
    });
});
