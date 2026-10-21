// @vitest-environment node
//
// Las órdenes de trabajo y el estado del activo: crear una OT correctiva lo saca de servicio, cerrar
// la última lo devuelve. Antes eran dos mundos que no se hablaban y un equipo podía quedar «En
// Mantenimiento» sin OT y sin salida (VALAR-ACT-0019, desde septiembre).
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
    in(c: string, arr: unknown[]) { this.filters.push(r => arr.includes(r[c])); return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    single() { this.one = 'single'; return this; }
    then(ok: any, ko: any) { return Promise.resolve(this.run()).then(ok, ko); }
    private run() {
        const rows = (db[this.table] ??= []);
        const wrap = (list: Row[]) => {
            const out = list.map(r => ({ ...r }));
            if (this.one) return { data: out[0] ?? null, error: null };
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
        if (this.op === 'delete') { db[this.table] = rows.filter(r => !hits.includes(r)); return { data: null, error: null }; }
        return wrap(hits);
    }
}

let codeSeq = 0;
vi.mock('@/modules/core/lib/supabase', () => ({ supabase: { from: (t: string) => new Q(t) } }));
vi.mock('@/modules/core/lib/sequence-utils', () => ({ nextInternalCode: async (_t: string, type: string) => `${type}-${String(++codeSeq).padStart(4, '0')}` }));

import { addMaintenanceOrder, updateMaintenanceOrder, closeMaintenanceOrder, syncAssetStatus } from './maintenanceMutations';

const T = 't1';
const ctx = { user: { id: 'u1', name: 'Mantenedor', role: 'jefe-mantencion', tenantId: T } as any, tenantId: T, can: () => true } as any;
const asset = () => db.materials[0];
const base = { materialId: 'm1', materialName: 'Taladro', type: 'CORRECTIVE', status: 'OPEN', priority: 'HIGH', description: 'No enciende' } as any;

beforeEach(() => {
    for (const k of Object.keys(db)) delete db[k];
    seq = 0; codeSeq = 0;
    db.materials = [{ id: 'm1', tenant_id: T, name: 'Taladro', usage_type: 'Herramienta Menor', status: 'Disponible', in_use: 0, stock: 1 }];
    db.maintenance_orders = [];
});

describe('OT y estado del activo', () => {
    it('una OT correctiva nueva saca el equipo de servicio', async () => {
        await addMaintenanceOrder(base, ctx);
        expect(asset().status).toBe('En Mantenimiento');
    });
    it('una preventiva sólo programada no lo saca', async () => {
        await addMaintenanceOrder({ ...base, type: 'PREVENTIVE' }, ctx);
        expect(asset().status).toBe('Disponible');
    });
    it('pasarla a «en curso» sí lo saca', async () => {
        await addMaintenanceOrder({ ...base, type: 'PREVENTIVE' }, ctx);
        await updateMaintenanceOrder(db.maintenance_orders[0].id, { status: 'IN_PROGRESS' }, ctx);
        expect(asset().status).toBe('En Mantenimiento');
    });
    it('cerrar la OT lo devuelve a «Disponible»', async () => {
        await addMaintenanceOrder(base, ctx);
        await closeMaintenanceOrder(db.maintenance_orders[0].id, { rootCauseAnalysis: 'carbones gastados' }, ctx);
        expect(db.maintenance_orders[0]).toMatchObject({ status: 'COMPLETED' });
        expect(asset().status).toBe('Disponible');
    });
    it('si alguien aún tiene unidades vuelve a «En Uso»', async () => {
        asset().in_use = 1;
        await addMaintenanceOrder(base, ctx);
        asset().status = 'En Mantenimiento';
        await closeMaintenanceOrder(db.maintenance_orders[0].id, {}, ctx);
        expect(asset().status).toBe('En Uso');
    });
    it('con dos OT abiertas, cerrar una no lo libera', async () => {
        await addMaintenanceOrder(base, ctx);
        await addMaintenanceOrder({ ...base, description: 'otra falla' }, ctx);
        await closeMaintenanceOrder(db.maintenance_orders[0].id, {}, ctx);
        expect(asset().status).toBe('En Mantenimiento');
        await closeMaintenanceOrder(db.maintenance_orders[1].id, {}, ctx);
        expect(asset().status).toBe('Disponible');
    });
    it('cancelar la OT también lo libera', async () => {
        await addMaintenanceOrder(base, ctx);
        await updateMaintenanceOrder(db.maintenance_orders[0].id, { status: 'CANCELLED' }, ctx);
        expect(asset().status).toBe('Disponible');
    });
    it('un equipo «Para Baja» no se revive por una OT', async () => {
        asset().status = 'Para Baja';
        await addMaintenanceOrder(base, ctx);
        await closeMaintenanceOrder(db.maintenance_orders[0].id, {}, ctx);
        expect(asset().status).toBe('Para Baja');
    });
    it('un consumible no cambia de estado', async () => {
        asset().usage_type = 'Consumible';
        await addMaintenanceOrder(base, ctx);
        expect(asset().status).toBe('Disponible');
    });
    it('syncAssetStatus no falla si el activo no existe', async () => {
        await expect(syncAssetStatus(T, 'nope')).resolves.toBeUndefined();
    });
});

describe('OT — códigos y guardas', () => {
    it('el código sale del contador de la empresa, no de «cuántas hay + 1»', async () => {
        await addMaintenanceOrder(base, ctx);
        db.maintenance_orders.pop(); // se borra una: con el cálculo viejo el número se repetía
        await addMaintenanceOrder(base, ctx);
        await addMaintenanceOrder(base, ctx);
        const codes = db.maintenance_orders.map(o => o.internal_code);
        expect(new Set(codes).size).toBe(codes.length);
    });
    it('cerrar dos veces la misma OT falla la segunda y no pisa el primer cierre', async () => {
        await addMaintenanceOrder(base, ctx);
        const id = db.maintenance_orders[0].id;
        await closeMaintenanceOrder(id, { rootCauseAnalysis: 'primera causa' }, ctx);
        const firstDate = db.maintenance_orders[0].completed_at;
        await expect(closeMaintenanceOrder(id, { rootCauseAnalysis: 'segunda' }, ctx)).rejects.toThrow(/ya estaba cerrada/);
        expect(db.maintenance_orders[0].root_cause_analysis).toBe('primera causa');
        expect(db.maintenance_orders[0].completed_at).toBe(firstDate);
    });
    it('actualizar o cerrar una OT inexistente (o de otra empresa) no pasa en silencio', async () => {
        await expect(updateMaintenanceOrder('nope', { status: 'IN_PROGRESS' }, ctx)).rejects.toThrow(/No se encontró/);
        await expect(closeMaintenanceOrder('nope', {}, ctx)).rejects.toThrow();
    });
});
