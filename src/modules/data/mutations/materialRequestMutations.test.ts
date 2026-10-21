// @vitest-environment node
//
// Retiros y devoluciones del pañol — la parte que es de LA APLICACIÓN.
//
// Aprobar, anular, devolver y entregar en ventanilla corren como una transacción en la base (migración
// 20261030000000), y esa lógica (descuento, cascada, desglose, kardex, todo-o-nada) se probó contra un
// Postgres real y en vivo contra el demo. Aquí se prueba lo que sigue siendo de la aplicación: que la clase
// se calcule de los materiales, que los permisos se validen ANTES de llamar a la base, que se llame con lo
// correcto, que el error de la base llegue tal cual a la persona, y los efectos de después (avisos, costo en
// finanzas, OT de un equipo con falla). El Supabase de abajo es un doble en memoria que aplica los filtros de
// verdad, y su `rpc` lo programa cada prueba.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
let seq = 0;

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
    is(c: string, v: null) { this.filters.push(r => (v === null ? r[c] == null : r[c] === v)); return this; }
    in(c: string, arr: unknown[]) { this.filters.push(r => arr.includes(r[c])); return this; }
    order() { return this; }
    limit() { return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(ok: any, ko: any) { return Promise.resolve(this.run()).then(ok, ko); }
    private run() {
        const rows = (db[this.table] ??= []);
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
// Por defecto «la función no existe» (migración sin aplicar); cada prueba programa lo que la base responde.
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
    rejectMaterialRequest, deleteMaterialRequest,
} from './materialRequestMutations';

const T = 't1';
const user = (role: string) => ({ id: `u-${role}`, name: role, role, tenantId: T } as any);
const ctxAdmin = { user: user('administrador'), tenantId: T, can: () => true } as any;
const ctxPanolero = { user: user('panolero'), tenantId: T, can: (p: string) => (ROLES.panolero.permissions as string[]).includes(p) } as any;
const ctxNadie = { user: user('operador'), tenantId: T, can: () => false } as any;

const stockOf = (id: string) => db.materials.find(m => m.id === id)!;
const req = (id: string) => db.material_requests.find(r => r.id === id)!;

function seed() {
    for (const k of Object.keys(db)) delete db[k];
    seq = 0; codeSeq = 0;
    rpcHandler = NO_RPC; rpcCalls.length = 0;
    notifyWithdrawal.mockClear(); reverseEntriesForSource.mockClear(); emitFinanceEntries.mockClear();
    db.materials = [
        { id: 'cons', tenant_id: T, name: 'Polera', usage_type: 'Consumible', stock: 10, in_use: 0, status: 'Disponible', criticality: 'C', unit_cost: 100 },
        { id: 'tool', tenant_id: T, name: 'Taladro', usage_type: 'Herramienta Menor', stock: 3, in_use: 0, status: 'Disponible', criticality: 'B', unit_cost: 5000 },
        { id: 'critA', tenant_id: T, name: 'Generador', usage_type: 'Activo Fijo', stock: 1, in_use: 0, status: 'Disponible', criticality: 'A', unit_cost: 900000 },
    ];
    db.material_requests = []; db.return_requests = [];
}
/** Un retiro ya autorizado por el ADC, listo para que el pañol lo apruebe. */
function pendingRequest(items: { materialId: string; quantity: number }[], extra: Row = {}) {
    const row = { id: `rq-${++seq}`, tenant_id: T, internal_code: `TX-${seq}`, items, status: 'pending', highest_class: 'A', adc_authorized_at: '2026-10-20T10:00:00Z', supervisor_id: 'sup', supervisor_name: 'Sup', area: 'Faena', contract_id: null, contract_name: null, ...extra };
    db.material_requests.push(row);
    return row.id;
}
const approvedRequest = (items: { materialId: string; quantity: number }[], extra: Row = {}) =>
    pendingRequest(items, { status: 'approved', approval_date: '2026-10-20T11:00:00Z', ...extra });

const rpcOk = (data: any) => { rpcHandler = async () => ({ data, error: null }); };
const rpcFail = (message: string, code = 'P0001') => { rpcHandler = async () => ({ data: null, error: { code, message } }); };
const polera = (qty: number, sources: any[]) => ({ material_id: 'cons', name: 'Polera', usage_type: 'Consumible', unit_cost: 100, class: 'C', qty, sources });
const returned = (condition: string | null, asset = true) => ({ code: 'RET-X', notes: 'se cayó', restocked: { material_id: 'tool', name: 'Taladro', usage_type: asset ? 'Herramienta Menor' : 'Consumible', condition } });

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
    it('junta el mismo material repetido y no admite cantidades en cero', async () => {
        await addMaterialRequest({ items: [{ materialId: 'cons', quantity: 2 }, { materialId: 'cons', quantity: 3 }], area: 'x', supervisorId: 's' }, ctxNadie);
        expect(db.material_requests[0].items).toEqual([{ materialId: 'cons', quantity: 5 }]);
        await expect(addMaterialRequest({ items: [{ materialId: 'cons', quantity: 0 }], area: 'x', supervisorId: 's' }, ctxNadie)).rejects.toThrow(/mayores que cero/);
    });
    it('si entra ya autorizada (quien pide es ADC), avisa directo al pañol', async () => {
        await addMaterialRequest({ items: [{ materialId: 'cons', quantity: 1 }], area: 'x', supervisorId: 's' }, ctxAdmin);
        expect(notifyWithdrawal).toHaveBeenCalledWith('authorized', expect.any(String));
    });
});

describe('aprobar — la base hace la transacción; la aplicación valida, avisa y registra el costo', () => {
    it('llama a la función con el id del retiro, avisa al solicitante y registra el costo del consumible', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }], { contract_id: 'c1', contract_name: 'Contrato 1' });
        rpcOk({ code: 'TX-1', contract_id: 'c1', contract_name: 'Contrato 1', class: 'C', items: [polera(2, [{ contract_id: null, qty: 2 }])] });
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(rpcCalls).toEqual([{ fn: 'approve_material_request', args: { p_request: id } }]);
        expect(stockOf('cons').stock).toBe(10); // el stock lo mueve la base (aquí un doble), no la aplicación
        expect(notifyWithdrawal).toHaveBeenCalledWith('approved', id);
        expect(emitFinanceEntries).toHaveBeenCalled(); // el costo del pool hacia el contrato
    });
    it('los permisos se validan ANTES: el pañolero no llega a la función con material clase A', async () => {
        const id = pendingRequest([{ materialId: 'critA', quantity: 1 }]);
        rpcOk({});
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/clase A/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('un retiro viejo guardado como A pero de material clase C SÍ lo aprueba el pañolero', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { highest_class: 'A' });
        rpcOk({ code: 'TX', items: [] });
        await updateMaterialRequestStatus(id, 'approved', ctxPanolero);
        expect(rpcCalls).toHaveLength(1);
    });
    it('quien no tiene ningún permiso no aprueba ni rechaza', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        rpcOk({});
        await expect(updateMaterialRequestStatus(id, 'approved', ctxNadie)).rejects.toThrow(/permiso/i);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxNadie)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
        expect(req(id).status).toBe('pending');
    });
    it('un retiro de otra empresa no se toca', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { tenant_id: 'otra' });
        rpcOk({});
        await expect(updateMaterialRequestStatus(id, 'approved', ctxAdmin)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('un retiro ya aprobado o rechazado no llega a la función', async () => {
        const a = approvedRequest([{ materialId: 'cons', quantity: 1 }]);
        const r = pendingRequest([{ materialId: 'cons', quantity: 1 }], { status: 'rejected' });
        rpcOk({});
        await expect(updateMaterialRequestStatus(a, 'approved', ctxPanolero)).rejects.toThrow(/ya fue aprobada/i);
        await expect(updateMaterialRequestStatus(r, 'approved', ctxPanolero)).rejects.toThrow(/ya fue rechazada/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('exige la autorización del ADC antes de llamar a la base', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        rpcOk({});
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/ADC/);
        expect(rpcCalls).toHaveLength(0);
    });
    it('el error de la base llega tal cual (sin stock, ya aprobada…)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        rpcFail('Stock insuficiente para Polera.');
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow('Stock insuficiente para Polera.');
        expect(notifyWithdrawal).not.toHaveBeenCalled();
        expect(emitFinanceEntries).not.toHaveBeenCalled();
    });
    it('si el costo no se puede registrar, lo dice (el despacho ya quedó firme en la base)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }], { contract_id: 'c1', contract_name: 'Contrato 1' });
        rpcOk({ code: 'TX-1', contract_id: 'c1', contract_name: 'Contrato 1', items: [polera(2, [{ contract_id: null, qty: 2 }])] });
        emitFinanceEntries.mockRejectedValueOnce(new Error('sin permiso en finanzas'));
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/quedó aprobado.*finanzas/i);
    });
    it('sin la migración dice claro qué falta (no sigue por un camino no atómico a escondidas)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/Falta aplicar la migración 20261030000000/);
        expect(stockOf('cons').stock).toBe(10);
        expect(req(id).status).toBe('pending');
    });
});

describe('rechazar — con motivo, sin tocar stock', () => {
    it('rechaza una vez; después ya no se puede aprobar ni rechazar', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await updateMaterialRequestStatus(id, 'rejected', ctxPanolero);
        expect(req(id).status).toBe('rejected');
        await expect(updateMaterialRequestStatus(id, 'approved', ctxPanolero)).rejects.toThrow(/ya fue/i);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('no rechaza lo que ya se aprobó (el stock ya salió)', async () => {
        const id = approvedRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(updateMaterialRequestStatus(id, 'rejected', ctxPanolero)).rejects.toThrow(/ya fue/i);
        expect(req(id).status).toBe('approved');
    });
    it('guarda el motivo en las notas, sin borrar lo que el solicitante escribió', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { notes: 'urgente para mañana' });
        await rejectMaterialRequest(id, 'No hay stock en este pañol', ctxPanolero);
        expect(req(id).status).toBe('rejected');
        expect(req(id).notes).toBe('urgente para mañana · Motivo del rechazo: No hay stock en este pañol');
    });
    it('sin notas previas queda sólo el motivo; sin motivo igual rechaza y no toca las notas', async () => {
        const a = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await rejectMaterialRequest(a, '  Pedido duplicado  ', ctxAdmin);
        expect(req(a).notes).toBe('Motivo del rechazo: Pedido duplicado');
        const b = pendingRequest([{ materialId: 'cons', quantity: 1 }], { notes: 'hola' });
        await rejectMaterialRequest(b, '', ctxAdmin);
        expect(req(b).status).toBe('rejected');
        expect(req(b).notes).toBe('hola');
    });
    it('exige permiso', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(rejectMaterialRequest(id, 'x', ctxNadie)).rejects.toThrow(/permiso/i);
    });
});

describe('autorizar (ADC)', () => {
    it('autoriza una vez y le avisa al pañol', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        await authorizeMaterialRequest(id, ctxAdmin);
        expect(req(id).adc_authorized_at).toBeTruthy();
        expect(notifyWithdrawal).toHaveBeenCalledWith('authorized', id);
        await expect(authorizeMaterialRequest(id, ctxAdmin)).rejects.toThrow(/ya fue autorizada/i);
    });
    it('una solicitud inexistente no pasa en silencio; sin permiso no autoriza', async () => {
        await expect(authorizeMaterialRequest('nope', ctxAdmin)).rejects.toThrow();
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }], { adc_authorized_at: null });
        await expect(authorizeMaterialRequest(id, ctxPanolero)).rejects.toThrow(/permiso/i);
    });
});

describe('anular un despacho aprobado que nadie retiró', () => {
    it('llama a la función con el motivo, avisa y reversa el costo', async () => {
        const id = approvedRequest([{ materialId: 'cons', quantity: 2 }]);
        rpcOk({ code: 'TX-9', items: [] });
        await cancelApprovedMaterialRequest(id, '  El trabajador no vino  ', ctxPanolero);
        expect(rpcCalls).toEqual([{ fn: 'cancel_approved_material_request', args: { p_request: id, p_reason: 'El trabajador no vino' } }]);
        expect(notifyWithdrawal).toHaveBeenCalledWith('cancelled', id);
        expect(reverseEntriesForSource).toHaveBeenCalledWith('material_request', 'TX-9', expect.stringContaining('El trabajador no vino'), expect.anything());
    });
    it('exige motivo, y lo ya entregado o lo que sigue pendiente no llega a la base', async () => {
        rpcOk({});
        const a = approvedRequest([{ materialId: 'cons', quantity: 2 }]);
        await expect(cancelApprovedMaterialRequest(a, '   ', ctxPanolero)).rejects.toThrow(/motivo/i);
        const d = approvedRequest([{ materialId: 'cons', quantity: 2 }], { delivery_date: '2026-10-21' });
        await expect(cancelApprovedMaterialRequest(d, 'x', ctxPanolero)).rejects.toThrow(/ya fue entregado/);
        const p = pendingRequest([{ materialId: 'cons', quantity: 2 }]);
        await expect(cancelApprovedMaterialRequest(p, 'x', ctxPanolero)).rejects.toThrow(/Sólo se puede anular/);
        expect(rpcCalls).toHaveLength(0);
    });
    it('sin permiso, o con material clase A siendo pañolero, no llega a la función', async () => {
        rpcOk({});
        const a = approvedRequest([{ materialId: 'cons', quantity: 2 }]);
        await expect(cancelApprovedMaterialRequest(a, 'x', ctxNadie)).rejects.toThrow(/permiso/i);
        const b = approvedRequest([{ materialId: 'critA', quantity: 1 }]);
        await expect(cancelApprovedMaterialRequest(b, 'x', ctxPanolero)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('el error de la base llega tal cual y no reversa nada', async () => {
        const id = approvedRequest([{ materialId: 'cons', quantity: 2 }]);
        rpcFail('Este despacho ya fue entregado: no se puede anular.');
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow(/ya fue entregado/);
        expect(reverseEntriesForSource).not.toHaveBeenCalled();
        expect(notifyWithdrawal).not.toHaveBeenCalled();
    });
    it('si el costo no se puede reversar lo dice (el stock ya volvió)', async () => {
        const id = approvedRequest([{ materialId: 'cons', quantity: 2 }]);
        rpcOk({ code: 'TX-9', items: [] });
        reverseEntriesForSource.mockRejectedValueOnce(new Error('sin acceso'));
        await expect(cancelApprovedMaterialRequest(id, 'x', ctxPanolero)).rejects.toThrow(/stock volvió.*finanzas/i);
    });
});

describe('deliverApprovedMaterialRequest — la entrega al trabajador', () => {
    it('entrega una vez; una segunda entrega no pisa la primera', async () => {
        const id = approvedRequest([{ materialId: 'cons', quantity: 1 }]);
        await deliverApprovedMaterialRequest(id, null, { id: 'w1', name: 'Worker' }, { mode: 'biometric' }, ctxPanolero);
        expect(req(id).delivery_date).toBeTruthy();
        await expect(deliverApprovedMaterialRequest(id, null, { id: 'w2', name: 'Otro' }, { mode: 'rut' }, ctxPanolero)).rejects.toThrow(/ya fue entregado/i);
        expect(req(id).received_by_user_id).toBe('w1');
    });
    it('un retiro sin aprobar no se entrega (antes «funcionaba» sin hacer nada)', async () => {
        const id = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(deliverApprovedMaterialRequest(id, null, null, null, ctxPanolero)).rejects.toThrow();
    });
});

describe('entrega directa en ventanilla', () => {
    it('llama a la función con los ítems juntados y el tope de clase según la revisión posterior; registra el costo', async () => {
        rpcOk({ request_id: 'r1', code: 'TX-0001', class: 'C', items: [polera(5, [{ contract_id: null, qty: 5 }])] });
        await addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 2 }, { materialId: 'cons', quantity: 3 }], area: 'Faena', supervisorId: 'w1', contractId: 'c1', contractName: 'Contrato 1', warehouseId: 'wh1' }, ctxPanolero);
        expect(rpcCalls).toHaveLength(1);
        expect(rpcCalls[0].fn).toBe('deliver_directly');
        expect(rpcCalls[0].args).toMatchObject({ p_items: [{ materialId: 'cons', quantity: 5 }], p_supervisor: 'w1', p_contract_id: 'c1', p_warehouse: 'wh1', p_requires_review: false, p_max_class: 'C' });
        expect(rpcCalls[0].args.p_code).toMatch(/^TX-/);
        expect(emitFinanceEntries).toHaveBeenCalled();
    });
    it('con revisión posterior el tope sube a B', async () => {
        rpcOk({ items: [] });
        await addAndApproveMaterialRequest({ items: [{ materialId: 'tool', quantity: 1 }], area: 'x', supervisorId: 'w1', requiresReview: true }, ctxPanolero);
        expect(rpcCalls[0].args).toMatchObject({ p_requires_review: true, p_max_class: 'B' });
    });
    it('usa el código que le pasen (flujo con aprobación previa)', async () => {
        rpcOk({ items: [] });
        await addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 1 }], area: 'x', supervisorId: 'w1', internalCode: 'TX-MIO' }, ctxPanolero);
        expect(rpcCalls[0].args.p_code).toBe('TX-MIO');
    });
    it('el error de la base (clase, stock) llega tal cual y no se registra costo', async () => {
        rpcFail('Generador es clase A: requiere aprobación antes de entregarse.');
        await expect(addAndApproveMaterialRequest({ items: [{ materialId: 'critA', quantity: 1 }], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow(/es clase A/);
        expect(emitFinanceEntries).not.toHaveBeenCalled();
    });
    it('sin ítems no llega a la base; sin la migración dice qué falta', async () => {
        await expect(addAndApproveMaterialRequest({ items: [], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow(/al menos un material/);
        await expect(addAndApproveMaterialRequest({ items: [{ materialId: 'cons', quantity: 1 }], area: 'x', supervisorId: 'w1' }, ctxPanolero)).rejects.toThrow(/Falta aplicar la migración/);
    });
});

describe('devoluciones', () => {
    const pendingRet = (extra: Row = {}) => {
        const row = { id: `rt-${++seq}`, tenant_id: T, internal_code: `RET-${seq}`, material_id: 'tool', material_name: 'Taladro', quantity: 1, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null, notes: 'se cayó', ...extra };
        db.return_requests.push(row);
        return row.id;
    };
    it('completar: llama a la función con la condición y la evidencia', async () => {
        const id = pendingRet();
        rpcOk(returned('OK'));
        await updateReturnRequestStatus(id, 'completed', { condition: 'OK', evidenceUrl: 'u.jpg' }, ctxPanolero);
        expect(rpcCalls[0]).toEqual({ fn: 'complete_return_request', args: { p_return: id, p_status: 'completed', p_condition: 'OK', p_evidence: 'u.jpg' } });
    });
    it('una devolución de otra empresa, ya resuelta, o sin permiso, no llega a la función', async () => {
        rpcOk(returned('OK'));
        await expect(updateReturnRequestStatus(pendingRet({ tenant_id: 'otra' }), 'completed', { condition: 'OK' }, ctxAdmin)).rejects.toThrow(/permiso/i);
        await expect(updateReturnRequestStatus(pendingRet({ status: 'completed' }), 'completed', { condition: 'OK' }, ctxAdmin)).rejects.toThrow(/ya fue completada/i);
        await expect(updateReturnRequestStatus(pendingRet(), 'completed', { condition: 'OK' }, ctxNadie)).rejects.toThrow(/permiso/i);
        expect(rpcCalls).toHaveLength(0);
    });
    it('el error de la base llega tal cual', async () => {
        rpcFail('Uno de los materiales ya no existe: no se puede reingresar.');
        await expect(updateReturnRequestStatus(pendingRet(), 'completed', { condition: 'OK' }, ctxPanolero)).rejects.toThrow(/ya no existe/);
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
    it('devolución directa: una llamada por ítem, con su código y sus datos', async () => {
        rpcOk(returned('ROTO'));
        await addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition: 'ROTO', notes: 'partido' }], notes: '', workerId: 'w1', workerName: 'W', contractId: 'c1', warehouseId: 'wh1' }, ctxPanolero);
        expect(rpcCalls).toHaveLength(1);
        expect(rpcCalls[0].fn).toBe('return_directly');
        expect(rpcCalls[0].args).toMatchObject({ p_material: 'tool', p_quantity: 1, p_condition: 'ROTO', p_worker: 'w1', p_contract_id: 'c1', p_warehouse: 'wh1', p_notes: 'partido' });
        expect(rpcCalls[0].args.p_code).toMatch(/^RET-/);
    });
    it('el error de la base en la devolución directa llega tal cual', async () => {
        rpcFail('Uno de los materiales ya no existe: no se puede reingresar.');
        await expect(addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition: 'OK' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero)).rejects.toThrow(/ya no existe/);
    });
});

describe('devolución con falla → OT correctiva (antes el equipo quedaba «En Mantenimiento» sin nadie a cargo)', () => {
    const direct = async (condition: 'OK' | 'CON FALLA' | 'ROTO', asset = true) => {
        rpcOk(returned(condition, asset));
        await addAndCompleteReturnRequest({ items: [{ materialId: 'tool', quantity: 1, materialName: 'Taladro', unit: 'u', condition, notes: 'no enciende' }], notes: '', workerId: 'w1', workerName: 'W' }, ctxPanolero);
    };
    it('con falla: se abre su OT correctiva con el detalle', async () => {
        await direct('CON FALLA');
        expect(db.maintenance_orders).toHaveLength(1);
        expect(db.maintenance_orders[0]).toMatchObject({ material_id: 'tool', type: 'CORRECTIVE', status: 'OPEN', priority: 'MEDIUM' });
        expect(db.maintenance_orders[0].description).toMatch(/con falla.*no enciende/);
    });
    it('un equipo roto abre la OT con prioridad alta', async () => {
        await direct('ROTO');
        expect(db.maintenance_orders[0].priority).toBe('HIGH');
    });
    it('devuelto en buen estado: no hay OT', async () => {
        await direct('OK');
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
    it('un consumible con falla no abre OT (no es un equipo)', async () => {
        await direct('CON FALLA', false);
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
    it('si ya hay una correctiva abierta de ese equipo no abre otra (una falla, una OT)', async () => {
        await direct('CON FALLA');
        await direct('CON FALLA');
        expect(db.maintenance_orders).toHaveLength(1);
    });
    it('por la revisión del pañol también abre la OT, con el detalle que devuelve la base', async () => {
        const id = (() => { const row = { id: 'rt-x', tenant_id: T, internal_code: 'RET-X', material_id: 'tool', material_name: 'Taladro', quantity: 1, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null, notes: 'se cayó' }; db.return_requests.push(row); return row.id; })();
        rpcOk(returned('CON FALLA'));
        await updateReturnRequestStatus(id, 'completed', { condition: 'CON FALLA' }, ctxPanolero);
        expect(db.maintenance_orders).toHaveLength(1);
        expect(db.maintenance_orders[0].description).toMatch(/RET-X.*se cayó/);
    });
    it('rechazar una devolución no abre OT', async () => {
        const id = (() => { const row = { id: 'rt-y', tenant_id: T, internal_code: 'RET-Y', material_id: 'tool', material_name: 'Taladro', quantity: 1, status: 'pending', supervisor_id: 'w1', supervisor_name: 'W', contract_id: null }; db.return_requests.push(row); return row.id; })();
        rpcOk({ code: 'RET-Y', notes: null, restocked: null });
        await updateReturnRequestStatus(id, 'rejected', undefined, ctxPanolero);
        expect(db.maintenance_orders ?? []).toHaveLength(0);
    });
});

describe('borrar solicitudes (sólo super-admin)', () => {
    const superAdmin = { user: user('super-admin'), tenantId: T, can: () => true } as any;
    it('sólo un super-admin, y no un despacho aprobado cuyo stock sigue afuera', async () => {
        const a = pendingRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(deleteMaterialRequest(a, ctxAdmin)).rejects.toThrow(/super-admin/);
        const b = approvedRequest([{ materialId: 'cons', quantity: 1 }]);
        await expect(deleteMaterialRequest(b, superAdmin)).rejects.toThrow(/anúlalo primero/);
        expect(db.material_requests).toHaveLength(2);
        await deleteMaterialRequest(a, superAdmin);
        expect(db.material_requests).toHaveLength(1);
    });
});
