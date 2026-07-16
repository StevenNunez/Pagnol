import { describe, expect, it } from 'vitest';
import { DEFAULT_TAX_RATE, buildEntryRow, netFromGross, toClp, type FinanceEntryInput } from './financeMath';

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
