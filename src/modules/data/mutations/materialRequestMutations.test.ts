// @vitest-environment node
//
// Retiros y devoluciones del pañol. Cada caso de aquí es un agujero real que dejaba un activo
// «perdido»: un retiro que nacía clase A y el pañolero no podía aprobar, una aprobación que
// descontaba el stock dos veces, un `UPDATE` que la RLS dejaba en 0 filas sin avisar, o un
// despacho aprobado que no se podía deshacer. El Supabase de abajo es un doble en memoria que
// aplica los filtros de verdad (eq / is / in / gt), de modo que las guardas se ejercitan.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let seq = 0;
let hooks: { table: string; op: string; fn: () => void; once: boolean }[] = [];
let failures: { table: string; op: string; times: number }[] = [];

class Q {
    private filters: ((r: Row) => boolean)[] = [];
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: any = null;
    private returning = false;
    private one: 'single' | 'maybe' | null = null;
    constructor(private table: string) {}
    select() { if (this.op !== 'select') this.returning = true; return this; }
    insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
    update(p: any) { this.op = 'update'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
    neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this; }
    is(c: string, v: null) { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    in(c: string, arr: unknown[]) { this.filters.push(r => arr.includes(r[c])); return this; }
    gt(c: string, v: number) { this.filters.push(r => Number(r[c]) > v); return this; }
    order() { return this; }
    limit() { return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(ok: any, ko: any) { return Promise.resolve(this.run()).then(ok, ko); }
    private run() {
        const rows = (db[this.table] ??= []);
        for (const h of hooks.filter(h => h.table === this.table && h.op === this.op)) { h.fn(); }
        hooks = hooks.filter(h => !(h.table === this.table && h.op === this.op && h.once));
        const f = failures.find(x => x.table === this.table && x.op === this.op && x.times > 0);
        if (f) { f.times--; return { data: null, error: { message: `fallo inyectado en ${this.table}.${this.op}`, code: 'X' } }; }
        const wrap = (list: Row[]) => {
            const out = list.map(r => ({ ...r }));
            if (this.one === 'single') return out.length ? { data: out[0], error: null } : { data: null, error: { message: 'sin filas', code: 'PGRST116' } };
            if (this.one === 'maybe') return { data: out[0] ?? null, error: null };
            return { data: out, error: null };
        };
        if (this.op === 'insert') {
            const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p: Row) => ({ id: `${this.table}-${++seq}`, ...p }));
            rows.push(...list);
            return this.returning || this.one ? wrap(list) : { data: null, error: null };
        }
        const hits = rows.filter(r => this.filters.every(p => p(r)));
        if (this.op === 'update') {
            hits.forEach(r => Object.assign(r, this.payload));
            return this.returning || this.one ? wrap(hits) : { data: null, error: null };
        }
        if (this.op === 'delete') {
            db[this.table] = rows.filter(r => !hits.includes(r));
            return { data: null, error: null };
        }
        return wrap(hits);
    }
}

let codeSeq = 0;
const NO_RPC = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' } });
let rpcHandler: (fn: string, args: any) => Promise<{ data: any; error: any }> = NO_RPC;
const rpcCalls: { fn: string; args: any }[] = [];
vi.mock('@/modules/core/lib/supabase', () => ({ supabase: {
    from: (t: string) => new Q(t),
    rpc: (fn: string, args: any) => { rpcCalls.push({ fn, args }); return rpcHandler(fn, args); },
    auth: { getSession: async () => ({ data: { session: null } }) },
} }));
vi.mock('@/modules/core/lib/sequence-utils', () => ({ nextInternalCode: async (_t: string, type: string) => `${type}-${String(++codeSeq).padStart(4, '0')}` }));
const notifyWithdrawal = vi.fn();
vi.mock('@/modules/core/lib/notify-authorizers', () => ({ notifyAuthorizers: vi.fn(), notifyWithdrawal: (...a: unknown[]) => notifyWithdrawal(...a) }));
const reverseEntriesForSource = vi.fn(async () => 1);
const emitFinanceEntries = vi.fn(async (..._a: unknown[]) => {});
vi.mock('./financeLedger', () => ({ emitFinanceEntries: (...a: unknown[]) => (emitFinanceEntries as any)(...a), reverseEntriesForSource: (...a: unknown[]) => (reverseEntriesForSource as any)(...a) }));

import { ROLES } from '@/modules/core/lib/permissions';
import {
    addMaterialRequest, authorizeMaterialRequest, updateMaterialRequestStatus, deliverApprovedMaterialRequest,
    cancelApprovedMaterialRequest, addAndApproveMaterialRequest, updateReturnRequestStatus, addAndCompleteReturnRequest,
    rejectMaterialRequest,
} from './materialRequestMutations';

const T = 't1';
const user = (role: string) => ({ id: `u-${role}`, name: role, role, tenantId: T } as any);
const ctxAdmin = { user: user('administrador'), tenantId: T, can: () => true } as any;
const ctxPanolero = { user: user('panolero'), tenantId: T, can: (p: string) => (ROLES.panolero.permissions as string[]).includes(p) } as any;
const ctxNadie = { user: user('operador'), tenantId: T, can: () => false } as any;

const stockOf = (id: string) => db.materials.find(m => m.id === id)!;
const ledgerOf = (id: string) => (db.material_stocks ?? []).filter(l => l.material_id === id).reduce((a, l) => a + Number(l.qty), 0);
const kardexOf = (id: string) => (db.stock_movements ?? []).filter(k => k.material_id === id);
const req = (id: string) => db.material_requests.find(r => r.id === id)!;

function seed() {
    for (const k of Object.keys(db)) delete db[k];
    hooks = []; failures = []; seq = 0; codeSeq = 0;
    rpcHandler = NO_RPC; rpcCalls.length = 0;
    notifyWithdrawal.mockClear(); reverseEntriesForSource.mockClear(); emitFinanceEntries.mockClear();
    db.materials = [
        { id: 'cons', tenant_id: T, name: 'Polera', usage_type: 'Consumible', stock: 10, in_use: 0, status: 'Disponible', criticality: 'C', unit_cost: 100 },
        { id: 'tool', tenant_id: T, name: 'Taladro', usage_type: 'Herramienta Menor', stock: 3, in_use: 0, status: 'Disponible', criticality: 'B', unit_cost: 5000 },
        { id: 'critA', tenant_id: T, name: 'Generador', usage_type: 'Activo Fijo', stock: 1, in_use: 0, status: 'Disponible', criticality: 'A', unit_cost: 900000 },
    ];
    db.material_stocks = db.materials.map(m => ({ id: `ms-${m.id}`, tenant_id: T, material_id: m.id, contract_id: null, warehouse_id: null, qty: m.stock }));
    db.material_requests = []; db.return_requests = []; db.stock_movements = [];
}
/** Un retiro ya autorizado por el ADC, listo para que el pañol lo apruebe. */
function pendingRequest(items: { materialId: string; quantity: number }[], extra: Row = {}) {
    const row = { id: `rq-${++seq}`, tenant_id: T, internal_code: `TX-${seq}`, items, status: 'pending', highest_class: 'A', adc_authorized_at: '2026-10-20T10:00:00Z', supervisor_id: 'sup', supervisor_name: 'Sup', area: 'Faena', contract_id: null, contract_name: null, ...extra };
    db.material_requests.push(row);
    return row.id;
}

beforeEach(seed);

describe('addMaterialRequest — la clase sale de los materiales', () => {
    it('una polera clase C queda clase C aunque nadie la mande (antes quedaba A)', async () => {
        await addMaterialRequest({ items: [{ materialId: 'cons', quantity: 2 }], area: 'x', supervisorId: 's' }, ctxNadie);
        expect(db.material_requests[0].highest_class).toBe('C');
    });
    it('ignora la clase que mande quien llama', async () => {
        await addMaterialRequest({ items: [{ materialId: 'cons', quantity: 2 }], area: 'x', supervisorId: 's', highestClass: 'A' }, ctxNadie);
        expect(db.material_requests[0].highest_class).toBe('C');
    });
    it('con varios materiales queda la más exigente', async () => {
        await addMaterialRequest({ items: [{ materialId: 'cons', quantity: 1 }, { materialId: 'tool', quantity: 1 }], area: 'x', supervisorId: 's' }, ctxNadie);
        expect(db.material_requests[0].highest_class).toBe('B');
    });
    it('rechaza un material que no existe en la empresa', async () => {
        await expect(addMaterialRequest({ items: [{ materialId: 'nope', quantity: 1 }], area: 'x', supervisorId: 's' }, ctxNadie)).rejects.toThrow(/no existe/i);
        expect(db.material_requests).toHaveLength(0);
    });
});

describe('updateMaterialRequestStatus — aprobar', () => {
    it('descuenta una vez: stock, in_use (activos), ledger y kardex', async () => {
        const id = pendingRequest([{ materialId: 'tool', quantity: 2 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(stockOf('tool')).toMatchObject({ stock: 1, in_use: 2, status: 'En Uso' });
        expect(ledgerOf('tool')).toBe(1);
        expect(kardexOf('tool')).toHaveLength(1);
        expect(req(id).status).toBe('approved');
    });
    it('aprobar OTRA VEZ no descuenta de nuevo', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 4 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(stockOf('cons').stock).toBe(6);
        expect(ledgerOf('cons')).toBe(6);
        expect(kardexOf('cons')).toHaveLength(1);
    });
    it('dos pañoleros a la vez: sólo uno aprueba y el stock baja una sola vez', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 4 }]);
        const [a, b] = await Promise.allSettled([updateMaterialRequestStatus(id, 'approved', ctxPanolero), updateMaterialRequestStatus(id, 'approved', ctxAdmin)]);
        expect([a.status, b.status].filter(s => s === 'fulfilled')).toHaveLength(1);
        expect(stockOf('cons').stock).toBe(6);
        expect(ledgerOf('cons')).toBe(6);
    });
    it('si el stock cambió mientras se aprobaba, no se pisa: falla y el retiro vuelve a pendiente', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 4 }]);
        hooks.push({ table: 'materials', op: 'update', once: true, fn: () => { stockOf('cons').stock = 7; } });
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/cambió|reintent/i);
        expect(req(id).status).toBe('pending');
        expect(stockOf('cons').stock).toBe(7);
        expect(kardexOf('cons')).toHaveLength(0);
    });
    it('si falla a medio camino (kardex) se deshace todo: stock, ledger y estado', async () => {
        const id = pendingRequest([{ materialId: 'tool', quantity: 2 }, { materialId: 'cons', quantity: 3 }]);
        failures.push({ table: 'stock_movements', op: 'insert', times: 99 });
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow();
        expect(stockOf('tool')).toMatchObject({ stock: 3, in_use: 0, status: 'Disponible' });
        expect(stockOf('cons').stock).toBe(10);
        expect(ledgerOf('tool')).toBe(3);
        expect(ledgerOf('cons')).toBe(10);
        expect(req(id).status).toBe('pending');
    });
    it('sin stock suficiente no toca nada', async () => {
        const id = pendingRequest([{ materialId: 'tool', quantity: 1 }, { materialId: 'cons', quantity: 99 }]);
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/stock insuficiente/i);
        expect(stockOf('tool').stock).toBe(3);
        expect(req(id).status).toBe('pending');
    });
    it('el mismo material dos veces en el retiro se suma (antes se pisaba)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }, { materialId: 'cons', quantity: 3 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(stockOf('cons').stock).toBe(5);
        expect(ledgerOf('cons')).toBe(5);
    });
    it('exige la autorización del ADC', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/ADC/);
        expect(stockOf('cons').stock).toBe(10);
    });
});

describe('updateMaterialRequestStatus — permisos por la clase REAL de los materiales', () => {
    it('el pañolero NO aprueba un retiro de un material clase A', async () => {
        const id = pendingRequest([{ materialId: 'critA', quantity: 1 }]);
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/clase A/i);
        expect(stockOf('critA').stock).toBe(1);
    });
    it('un retiro viejo guardado como A pero de material clase C SÍ lo aprueba el pañolero', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { highest_class: 'A' });
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(req(id).status).toBe('approved');
    });
    it('quien no tiene ningún permiso no aprueba ni rechaza', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(updateMaterialRequestStatus(id, 'approved', ctxNadie)).rejects.toThrow(/permiso/i);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxNadie)).rejects.toThrow(/permiso/i);
        expect(req(id).status).toBe('pending');
    });
    it('un retiro de otra empresa no se toca', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { tenant_id: 'otra' });
        await expect(updateMaterialRequestStatus(id, 'approved', ctxAdmin)).rejects.toThrow(/permiso/i);
    });
});

describe('updateMaterialRequestStatus — rechazar', () => {
    it('rechaza una vez; después ya no se puede aprobar ni rechazar', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(id, 'rejected', ctxPanolero);
        expect(req(id).status).toBe('rejected');
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/ya fue/i);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(stockOf('cons').stock).toBe(10);
    });
    it('no rechaza lo que ya se aprobó (el stock ya salió)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(req(id).status).toBe('approved');
    });
});

describe('cancelApprovedMaterialRequest — deshacer un despacho aprobado que nadie retiró', () => {
    async function approved(items = [{ materialId: 'tool', quantity: 2 }, { materialId: 'cons', quantity: 4 }]) {
        const id = pendingRequest(items, { contract_id: 'c1', contract_name: 'Contrato 1' });
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        return id;
    }
    it('devuelve stock, in_use, estado y ledger, y el retiro vuelve a «por aprobar»', async () => {
        const id = await approved();
        expect(stockOf('tool')).toMatchObject({ stock: 1, in_use: 2, status: 'En Uso' });
        await cancelApprovedMaterialRequest(id, 'El trabajador no vino', ctxPanolero);
        expect(stockOf('tool')).toMatchObject({ stock: 3, in_use: 0, status: 'Disponible' });
        expect(stockOf('cons').stock).toBe(10);
        expect(ledgerOf('tool')).toBe(3);
        expect(ledgerOf('cons')).toBe(10);
        expect(req(id)).toMatchObject({ status: 'pending', approval_date: null, approver_id: null });
        expect(kardexOf('cons').some(k => /anulaci/i.test(k.justification))).toBe(true);
    });
    it('reversa el costo que la aprobación había emitido en finanzas', async () => {
        const id = await approved();
        await cancelApprovedMaterialRequest(id, 'x', ctxPanolero);
        expect(reverseEntriesForSource).toHaveBeenCalledWith('material_request', req(id).internal_code, expect.any(String), expect.anything());
    });
    it('anular dos veces no devuelve dos veces', async () => {
        const id = await approved();
        await cancelApprovedMaterialRequest(id, 'x', ctxPanolero);
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow();
        expect(stockOf('cons').stock).toBe(10);
        expect(ledgerOf('cons')).toBe(10);
    });
    it('no se puede anular lo ya entregado ni lo que sigue pendiente', async () => {
        const id = await approved();
        await deliverApprovedMaterialRequest(id, null, null, null, ctxPanolero);
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow(/entreg/i);
        const p = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(cancelApprovedMaterialRequest(p, 'x', ctxPanolero)).rejects.toThrow();
        expect(stockOf('cons').stock).toBe(6);
    });
    it('sin permiso no anula', async () => {
        const id = await approved();
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxNadie)).rejects.toThrow(/permiso/i);
        expect(req(id).status).toBe('approved');
    });
    it('un retiro aprobado de material clase A no lo anula el pañolero', async () => {
        const id = pendingRequest([{ materialId: 'critA', quantity: 1 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxAdmin);
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow(/permiso/i);
    });
    it('si el reingreso falla a medio camino queda aprobado y con el stock afuera, como antes', async () => {
        const id = await approved();
        failures.push({ table: 'stock_movements', op: 'insert', times: 99 });
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow();
        expect(req(id).status).toBe('approved');
        expect(stockOf('tool')).toMatchObject({ stock: 1, in_use: 2 });
        expect(ledgerOf('tool')).toBe(1);
    });
});

describe('deliverApprovedMaterialRequest', () => {
    it('entrega una vez; una segunda entrega no pisa la primera', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        await deliverApprovedMaterialRequest(id, null, { id: 'w1', name: 'Worker' }, { mode: 'biometric' }, ctxPanolero);
        const first = req(id).delivery_date;
        expect(first).toBeTruthy();
        await expect(deliverApprovedMaterialRequest(id, null, { id: 'w2', name: 'Otro' }, { mode: 'rut' }, ctxPanolero)).rejects.toThrow(/ya|aprobad/i);
        expect(req(id).received_by_user_id).toBe('w1');
    });
    it('un retiro sin aprobar no se entrega (antes «funcionaba» sin hacer nada)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(deliverApprovedMaterialRequest(id, null, null, null, ctxPanolero)).rejects.toThrow();
    });
});

describe('authorizeMaterialRequest', () => {
    it('autoriza una vez y le avisa al pañol', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        await authorizeMaterialRequest(id, { ...ctxAdmin, can: () => true });
        expect(req(id).adc_authorized_at).toBeTruthy();
        expect(notifyWithdrawal).toHaveBeenCalledWith('authorized', id);
        await expect(authorizeMaterialRequest(id, ctxAdmin)).rejects.toThrow(/ya/i);
    });
    it('una solicitud inexistente o de otra empresa no pasa en silencio', async () => {
        await expect(authorizeMaterialRequest('nope', ctxAdmin)).rejects.toThrow();
    });
    it('sin permiso de autorizar no autoriza', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        await expect(authorizeMaterialRequest(id, ctxPanolero)).rejects.toThrow(/permiso/i);
    });
});

describe('aprobación avisa al solicitante', () => {
    it('al aprobar: aviso «listo para retiro»; al rechazar no', async () => {
        const a = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(a, 'approved', ctxPanolero);
        expect(notifyWithdrawal).toHaveBeenCalledWith('approved', a);
        notifyWithdrawal.mockClear();
        const b = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(b, 'rejected', ctxPanolero);
        expect(notifyWithdrawal).not.toHaveBeenCalled();
    });
});

describe('addAndApproveMaterialRequest — entrega directa', () => {
    it('entrega: crea el retiro entregado y descuenta una vez', async () => {
        await addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 3 }], area: 'x', supervisorId: 'w1' }, ctxPanolero);
        expect(db.material_requests).toHaveLength(1);
        expect(db.material_requests[0]).toMatchObject({ status: 'approved', highest_class: 'C' });
        expect(stockOf('cons').stock).toBe(7);
        expect(ledgerOf('cons')).toBe(7);
    });
    it('no entrega clase A sin aprobación previa', async () => {
        await expect(addAndApproveMaterialRequest({ items: [{ materialId: 'critA', quantity: 1 }], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow(/clase A/i);
        expect(db.material_requests).toHaveLength(0);
    });
    it('si falla el descuento, NO queda un retiro «entregado» con el stock intacto', async () => {
        failures.push({ table: 'stock_movements', op: 'insert', times: 99 });
        await expect(addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 3 }], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow();
        expect(db.material_requests).toHaveLength(0);
        expect(stockOf('cons').stock).toBe(10);
        expect(ledgerOf('cons')).toBe(10);
    });
});

describe('devoluciones', () => {
    const pendingReturn = (extra: Row = {}) => {
        stockOf('tool').stock = 1; stockOf('tool').in_use = 2; stockOf('tool').status = 'En Uso';
        db.material_stocks.find(l => l.material_id === 'tool')!.qty = 1;
        const row = { id: `rt-${++seq}`, tenant_id: T, internal_code: `RET-${seq}`, material_id: 'tool', material_name: 'Taladro', quantity: 2, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null, contract_name: null, ...extra };
        db.return_requests.push(row);
        return row.id;
    };
    it('completar suma el stock una vez; completar de nuevo no lo suma otra vez', async () => {
        const id = pendingReturn();
        await updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxPanolero);
        expect(stockOf('tool')).toMatchObject({ stock: 3, in_use: 0, status: 'Disponible' });
        await expect(updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxAdmin)).rejects.toThrow(/ya fue/i);
        expect(stockOf('tool').stock).toBe(3);
        expect(ledgerOf('tool')).toBe(3);
    });
    it('una devolución de otra empresa no se completa', async () => {
        const id = pendingReturn({ tenant_id: 'otra' });
        await expect(updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxAdmin)).rejects.toThrow(/permiso/i);
        expect(stockOf('tool').stock).toBe(1);
    });
    it('sin permiso no completa', async () => {
        const id = pendingReturn();
        await expect(updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxNadie)).rejects.toThrow(/permiso/i);
    });
    it('si falla el reingreso, la devolución vuelve a pendiente y el stock no cambia', async () => {
        const id = pendingReturn();
        failures.push({ table: 'stock_movements', op: 'insert', times: 99 });
        await expect(updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxPanolero)).rejects.toThrow();
        expect(db.return_requests.find(r => r.id === id)!.status).toBe('pending');
        expect(stockOf('tool')).toMatchObject({ stock: 1, in_use: 2 });
        expect(ledgerOf('tool')).toBe(1);
    });
    it('devolución inmediata: si el reingreso falla no queda una devolución «completada» fantasma', async () => {
        stockOf('tool').stock = 1; stockOf('tool').in_use = 2; db.material_stocks.find(l => l.material_id === 'tool')!.qty = 1;
        failures.push({ table: 'stock_movements', op: 'insert', times: 99 });
        await expect(addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 2, materialName: 'Taladro', unit: 'u', condition: 'OK' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero)).rejects.toThrow();
        expect(db.return_requests).toHaveLength(0);
        expect(stockOf('tool')).toMatchObject({ stock: 1, in_use: 2 });
    });
    it('una devolución con falla deja el activo en mantenimiento (comportamiento que se conserva)', async () => {
        const id = pendingReturn();
        await updateReturnRequestStatus(id, 'completed', { condition: 'CON FALLA' }, ctxPanolero);
        expect(stockOf('tool').status).toBe('En Mantenimiento');
    });
});

describe('rejectMaterialRequest — el rechazo deja su motivo para quien lo pidió', () => {
    it('guarda el motivo en las notas, sin borrar lo que el solicitante escribió', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { notes: 'urgente para mañana' });
        await rejectMaterialRequest(id, 'No hay stock en este pañol', ctxPanolero);
        expect(req(id).status).toBe('rejected');
        expect(req(id).notes).toBe('urgente para mañana · Motivo del rechazo: No hay stock en este pañol');
        expect(stockOf('cons').stock).toBe(10);
    });
    it('sin notas previas, queda sólo el motivo', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await rejectMaterialRequest(id, '  Pedido duplicado  ', ctxAdmin);
        expect(req(id).notes).toBe('Motivo del rechazo: Pedido duplicado');
    });
    it('sin motivo igual rechaza (el ADC puede no escribirlo) y no toca las notas', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { notes: 'hola' });
        await rejectMaterialRequest(id, '', ctxAdmin);
        expect(req(id).status).toBe('rejected');
        expect(req(id).notes).toBe('hola');
    });
    it('tiene las mismas guardas: permiso, y una sola vez', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(rejectMaterialRequest(id, 'x', ctxNadie)).rejects.toThrow(/permiso/i);
        await rejectMaterialRequest(id, 'x', ctxPanolero);
        await expect(rejectMaterialRequest(id, 'otra vez', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(req(id).notes).toBe('Motivo del rechazo: x');
    });
});

describe('devolución con falla → OT correctiva (antes el equipo quedaba «En Mantenimiento» sin nadie a cargo)', () => {
    const returnWith = async (condition: 'OK' | 'CON FALLA' | 'ROTO') => {
        stockOf('tool').stock = 1; stockOf('tool').in_use = 2; stockOf('tool').status = 'En Uso';
        db.material_stocks.find(l => l.material_id === 'tool')!.qty = 1;
        await addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition, notes: 'no enciende' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero);
    };
    it('con falla: queda en mantenimiento y se abre su OT correctiva con el detalle', async () => {
        await returnWith('CON FALLA');
        expect(stockOf('tool').status).toBe('En Mantenimiento');
        expect(db.maintenance_orders).toHaveLength(1);
        expect(db.maintenance_orders[0]).toMatchObject({ material_id: 'tool', type: 'CORRECTIVE', status: 'OPEN', priority: 'MEDIUM' });
        expect(db.maintenance_orders[0].description).toMatch(/con falla.*no enciende/);
    });
    it('un equipo roto abre la OT con prioridad alta', async () => {
        await returnWith('ROTO');
        expect(db.maintenance_orders[0].priority).toBe('HIGH');
    });
    it('devuelto en buen estado: no hay OT', async () => {
        await returnWith('OK');
        expect(db.maintenance_orders ?? []).toHaveLength(0);
        expect(stockOf('tool').status).toBe('En Uso');
    });
    it('un consumible con falla no abre OT (no es un equipo)', async () => {
        await addAndCompleteReturnRequest({ items: [{ materialId: 'cons', quantity: 1, materialName: 'Polera', unit: 'u', condition: 'CON FALLA' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero);
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
    it('si ya hay una correctiva abierta de ese equipo no abre otra (una falla, una OT)', async () => {
        await returnWith('CON FALLA');
        await returnWith('CON FALLA');
        expect(db.maintenance_orders).toHaveLength(1);
    });
    it('por la revisión del pañol también abre la OT', async () => {
        stockOf('tool').stock = 1; stockOf('tool').in_use = 2; db.material_stocks.find(l => l.material_id === 'tool')!.qty = 1;
        db.return_requests.push({ id: 'rt-x', tenant_id: T, internal_code: 'RET-X', material_id: 'tool', material_name: 'Taladro', quantity: 1, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null, notes: 'se cayó' });
        await updateReturnRequestStatus('rt-x', 'completed', { condition: 'CON FALLA' }, ctxPanolero);
        expect(db.maintenance_orders).toHaveLength(1);
        expect(db.maintenance_orders[0].description).toMatch(/RET-X.*se cayó/);
    });
});


// ─────────────────────────────────────────────────────────────────────────────────────────────
// Camino atómico (migración 20261030000000): la base hace aprobar/anular/devolver/entregar en UNA
// transacción. Aquí se prueba lo que sigue siendo de la aplicación: que los permisos se validen
// ANTES de llamar, que se llame con lo correcto, que el error de la base llegue tal cual a la
// persona, y los efectos de después (avisos, costo en finanzas, OT). La lógica de la base se probó
// aparte contra un Postgres real.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const rpcOk = (data: any) => { rpcHandler = async () => ({ data, error: null }); };
const rpcFail = (message: string, code = 'P0001') => { rpcHandler = async () => ({ data: null, error: { code, message } }); };
const polera = (qty: number, sources: any[]) => ({ material_id: 'cons', name: 'Polera', usage_type: 'Consumible', unit_cost: 100, class: 'C', qty, sources });
const legacyUntouched = () => { expect(stockOf('cons').stock).toBe(10); expect(kardexOf('cons')).toHaveLength(0); };

describe('camino atómico — aprobar', () => {
    it('llama a la función con el id del retiro, avisa al solicitante y registra el costo; no toca nada por su cuenta', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }], { contract_id: 'c1', contract_name: 'Contrato 1' });
        rpcOk({ code: 'TX-1', contract_id: 'c1', contract_name: 'Contrato 1', class: 'C', items: [polera(2, [{ contract_id: null, qty: 2 }])] });
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(rpcCalls).toEqual([{ fn: 'approve_material_request', args: { p_request: id } }]);
        legacyUntouched();
        expect(req(id).status).toBe('pending'); // la base lo cambia; aquí la base es un doble
        expect(notifyWithdrawal).toHaveBeenCalledWith('approved', id);
        expect(emitFinanceEntries).toHaveBeenCalled(); // el costo de un consumible del pool hacia el contrato
    });
    it('los permisos se validan ANTES: un pañolero no llega a la función con material clase A', async () => {
        const id = pendingRequest([{ materialId: 'critA', quantity: 1 }]);
        rpcOk({});
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/clase A/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('el error de la base llega tal cual (ya fue aprobada, sin stock…) y no se cae al respaldo', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        rpcFail('Esta solicitud ya fue aprobada.');
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow('Esta solicitud ya fue aprobada.');
        legacyUntouched();
        expect(rpcCalls).toHaveLength(1);
    });
    it('si el costo no se puede registrar, lo dice (el despacho ya quedó firme en la base)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }], { contract_id: 'c1', contract_name: 'Contrato 1' });
        rpcOk({ code: 'TX-1', contract_id: 'c1', contract_name: 'Contrato 1', items: [polera(2, [{ contract_id: null, qty: 2 }])] });
        emitFinanceEntries.mockRejectedValueOnce(new Error('sin permiso en finanzas'));
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/quedó aprobado.*finanzas/i);
    });
    it('sin la migración (la función no existe) sigue el respaldo de la Fase 1', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(rpcCalls.map(c => c.fn)).toEqual(['approve_material_request']);
        expect(stockOf('cons').stock).toBe(8);
        expect(req(id).status).toBe('approved');
    });
});

describe('camino atómico — anular', () => {
    it('llama a la función con el motivo, avisa y reversa el costo', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        db.material_requests.find(r => r.id === id)!.status = 'approved';
        rpcOk({ code: 'TX-9', items: [] });
        await cancelApprovedMaterialRequest(id, '  El trabajador no vino  ', ctxPanolero);
        expect(rpcCalls).toEqual([{ fn: 'cancel_approved_material_request', args: { p_request: id, p_reason: 'El trabajador no vino' } }]);
        expect(notifyWithdrawal).toHaveBeenCalledWith('cancelled', id);
        expect(reverseEntriesForSource).toHaveBeenCalledWith('material_request', 'TX-9', expect.stringContaining('El trabajador no vino'), expect.anything());
    });
    it('sin permiso no llega a la función', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        db.material_requests.find(r => r.id === id)!.status = 'approved';
        rpcOk({});
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxNadie)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('el error de la base llega tal cual', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        db.material_requests.find(r => r.id === id)!.status = 'approved';
        rpcFail('Este despacho ya fue entregado: no se puede anular.');
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow(/ya fue entregado/);
        expect(reverseEntriesForSource).not.toHaveBeenCalled();
    });
});

describe('camino atómico — devoluciones', () => {
    const pendingRet = (extra: Row = {}) => {
        const row = { id: `rt-${++seq}`, tenant_id: T, internal_code: `RET-${seq}`, material_id: 'tool', material_name: 'Taladro', quantity: 1, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null, notes: 'se cayó', ...extra };
        db.return_requests.push(row);
        return row.id;
    };
    it('completar con falla: llama a la función y abre la OT con el detalle que devuelve la base', async () => {
        const id = pendingRet();
        rpcOk({ code: 'RET-X', notes: 'se cayó', restocked: { material_id: 'tool', name: 'Taladro', usage_type: 'Herramienta Menor', condition: 'CON FALLA' } });
        await updateReturnRequestStatus(id, 'completed', { condition: 'CON FALLA', evidenceUrl: 'u.jpg' }, ctxPanolero);
        expect(rpcCalls[0]).toEqual({ fn: 'complete_return_request', args: { p_return: id, p_status: 'completed', p_condition: 'CON FALLA', p_evidence: 'u.jpg' } });
        expect(db.maintenance_orders).toHaveLength(1);
        expect(db.maintenance_orders[0].description).toMatch(/RET-X.*se cayó/);
    });
    it('en buen estado no abre OT; rechazar tampoco', async () => {
        const a = pendingRet();
        rpcOk({ code: 'RET-A', restocked: { material_id: 'tool', name: 'Taladro', usage_type: 'Herramienta Menor', condition: 'OK' } });
        await updateReturnRequestStatus(a, 'completed', { condition: 'OK' }, ctxPanolero);
        const b = pendingRet();
        rpcOk({ code: 'RET-B', restocked: null });
        await updateReturnRequestStatus(b, 'rejected', undefined, ctxPanolero);
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
    it('sin permiso no llega a la función', async () => {
        const id = pendingRet();
        rpcOk({});
        await expect(updateReturnRequestStatus(id, 'completed', { condition: 'OK' }, ctxNadie)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('devolución directa: una llamada por ítem, con su código, y abre la OT si vino con falla', async () => {
        rpcOk({ restocked: { material_id: 'tool', name: 'Taladro', usage_type: 'Herramienta Menor' } });
        await addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition: 'ROTO', notes: 'partido' }], notes: '', workerId: 'w1', workerName: 'W', contractId: 'c1', warehouseId: 'wh1' }, ctxPanolero);
        expect(rpcCalls).toHaveLength(1);
        expect(rpcCalls[0].fn).toBe('return_directly');
        expect(rpcCalls[0].args).toMatchObject({ p_material: 'tool', p_quantity: 1, p_condition: 'ROTO', p_worker: 'w1', p_contract_id: 'c1', p_warehouse: 'wh1', p_notes: 'partido' });
        expect(rpcCalls[0].args.p_code).toMatch(/^RET-/);
        expect(db.return_requests ?? []).toHaveLength(0); // la base inserta; aquí es un doble
        expect(db.maintenance_orders[0].priority).toBe('HIGH');
    });
    it('el error de la base en la devolución directa llega tal cual y no deja nada a medias', async () => {
        rpcFail('Uno de los materiales ya no existe: no se puede reingresar.');
        await expect(addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition: 'OK' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero)).rejects.toThrow(/ya no existe/);
        expect(db.return_requests ?? []).toHaveLength(0);
    });
});

describe('camino atómico — entrega directa', () => {
    it('llama a la función con los ítems juntados y el tope de clase según la revisión posterior', async () => {
        rpcOk({ request_id: 'r1', code: 'TX-0001', class: 'C', items: [polera(5, [{ contract_id: null, qty: 5 }])] });
        await addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 2 }, { materialId: 'cons', quantity: 3 }], area: 'Faena', supervisorId: 'w1', contractId: 'c1', contractName: 'Contrato 1', warehouseId: 'wh1' }, ctxPanolero);
        expect(rpcCalls).toHaveLength(1);
        expect(rpcCalls[0].fn).toBe('deliver_directly');
        expect(rpcCalls[0].args).toMatchObject({ p_items: [{ materialId: 'cons', quantity: 5 }], p_supervisor: 'w1', p_contract_id: 'c1', p_warehouse: 'wh1', p_requires_review: false, p_max_class: 'C' });
        expect(db.material_requests).toHaveLength(0); // la base inserta el retiro; aquí es un doble
        expect(emitFinanceEntries).toHaveBeenCalled();
    });
    it('con revisión posterior el tope sube a B', async () => {
        rpcOk({ items: [] });
        await addAndApproveMaterialRequest({ items: [{ materialId: 'tool', quantity: 1 }], area: 'x', supervisorId: 'w1', requiresReview: true }, ctxPanolero);
        expect(rpcCalls[0].args).toMatchObject({ p_requires_review: true, p_max_class: 'B' });
    });
    it('el error de la base (clase, stock) llega tal cual y no se cae al respaldo', async () => {
        rpcFail('Generador es clase A: requiere aprobación antes de entregarse.');
        await expect(addAndApproveMaterialRequest({ items: [{ materialId: 'critA', quantity: 1 }], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow(/es clase A/);
        expect(db.material_requests).toHaveLength(0);
        expect(rpcCalls).toHaveLength(1);
    });
    it('sin la migración sigue el respaldo y entrega igual', async () => {
        await addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 3 }], area: 'x', supervisorId: 'w1' }, ctxPanolero);
        expect(db.material_requests).toHaveLength(1);
        expect(stockOf('cons').stock).toBe(7);
    });
});
