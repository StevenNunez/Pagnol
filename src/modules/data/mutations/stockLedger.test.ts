// @vitest-environment node
//
// transferInLedger: mover existencias entre contratos Y entre pañoles. La suma
// del desglose no puede cambiar nunca (invariante sum(material_stocks) == stock).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; tenant_id: string; material_id: string; contract_id: string | null; warehouse_id: string | null; qty: number };
const rows: Row[] = [];
let seq = 0;

class Q {
    private preds: ((r: Row) => boolean)[] = [];
    private op: 'select' | 'update' | 'insert' = 'select';
    private payload: any = null;
    private one = false;
    select() { return this; }
    update(p: any) { this.op = 'update'; this.payload = p; return this; }
    insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
    eq(c: keyof Row, v: unknown) { this.preds.push(r => r[c] === v); return this; }
    is(c: keyof Row, v: null) { this.preds.push(r => r[c] === v); return this; }
    gt(c: keyof Row, v: number) { this.preds.push(r => Number(r[c]) > v); return this; }
    maybeSingle() { this.one = true; return this; }
    then(ok: any, ko: any) {
        let res: any;
        if (this.op === 'insert') { rows.push({ id: `r${++seq}`, ...this.payload }); res = { data: null, error: null }; }
        else {
            const hits = rows.filter(r => this.preds.every(p => p(r)));
            if (this.op === 'update') hits.forEach(r => Object.assign(r, this.payload));
            res = { data: this.one ? hits[0] ?? null : hits.map(r => ({ ...r })), error: null };
        }
        return Promise.resolve(res).then(ok, ko);
    }
}
vi.mock('@/modules/core/lib/supabase', () => ({ supabase: { from: () => new Q() } }));

import { transferInLedger } from './stockLedger';

const T = 't1', M = 'm1', C1 = 'contrato-1', W_CENTRAL = 'bodega-central', W_TORRES = 'panol-torres';
const put = (contract_id: string | null, warehouse_id: string | null, qty: number) =>
    rows.push({ id: `r${++seq}`, tenant_id: T, material_id: M, contract_id, warehouse_id, qty });
const qtyAt = (contract_id: string | null, warehouse_id: string | null) =>
    rows.filter(r => r.contract_id === contract_id && r.warehouse_id === warehouse_id).reduce((a, r) => a + r.qty, 0);
const total = () => rows.reduce((a, r) => a + r.qty, 0);
const move = (p: Partial<Parameters<typeof transferInLedger>[0]> & { qty: number }) =>
    transferInLedger({ tenantId: T, materialId: M, fromContractId: null, toContractId: null, ...p });

beforeEach(() => { rows.length = 0; });

describe('transferInLedger', () => {
    it('ubica en un pañol lo que estaba en el pool sin pañol (mismo contrato, otro pañol)', async () => {
        put(null, null, 3);
        await move({ qty: 1, fromWarehouseId: null, warehouseId: W_CENTRAL });
        expect(qtyAt(null, null)).toBe(2);
        expect(qtyAt(null, W_CENTRAL)).toBe(1);
        expect(total()).toBe(3);
    });

    it('asigna a un contrato desde un pañol concreto, sin tocar otros pañoles', async () => {
        put(null, W_CENTRAL, 1);
        put(null, W_TORRES, 5);
        await move({ qty: 1, toContractId: C1, fromWarehouseId: W_CENTRAL, warehouseId: W_TORRES });
        expect(qtyAt(null, W_CENTRAL)).toBe(0);
        expect(qtyAt(null, W_TORRES)).toBe(5);
        expect(qtyAt(C1, W_TORRES)).toBe(1);
        expect(total()).toBe(6);
    });

    it('sin pañol de origen indicado sigue tomando de cualquiera (comportamiento anterior)', async () => {
        put(null, W_CENTRAL, 2);
        await move({ qty: 2, toContractId: C1 });
        expect(qtyAt(C1, null)).toBe(2);
        expect(total()).toBe(2);
    });

    it('rechaza el mismo contrato y el mismo pañol, y el mismo contrato sin pañol de origen', async () => {
        put(null, W_CENTRAL, 2);
        await expect(move({ qty: 1, fromWarehouseId: W_CENTRAL, warehouseId: W_CENTRAL })).rejects.toThrow(/mismo contrato y el mismo pañol/);
        await expect(move({ qty: 1, fromWarehouseId: null, warehouseId: null })).rejects.toThrow();
        await expect(move({ qty: 1, warehouseId: W_TORRES })).rejects.toThrow(/mismo/);
        expect(qtyAt(null, W_CENTRAL)).toBe(2);
    });

    it('rechaza si el pañol de origen no tiene suficiente, aunque otros pañoles sí', async () => {
        put(null, W_CENTRAL, 1);
        put(null, W_TORRES, 9);
        await expect(move({ qty: 2, toContractId: C1, fromWarehouseId: W_CENTRAL })).rejects.toThrow(/insuficientes/);
        expect(total()).toBe(10);
    });
});
