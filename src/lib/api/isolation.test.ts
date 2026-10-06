// @vitest-environment node
//
// Aislamiento entre empresas de la API pública v1. Los endpoints corren con el
// cliente service role (sin RLS): si alguno olvida filtrar por la empresa de
// la API key, aquí devuelve filas de la otra empresa y el test falla.
//
// Se reemplaza Supabase por una base en memoria que aplica de verdad los
// filtros de igualdad (eq / is / in / gt / gte / limit). Los filtros `or`
// (búsqueda, cursor, tipo de producto) se registran pero no se aplican: eso
// sólo agranda el resultado, así que no puede ocultar una fuga.
//
// Las funciones de Postgres (escrituras, responsables) se emulan aquí sólo en
// lo que importa para el aislamiento: que reciban el tenant de la llave y que
// con él no encuentren lo de otra empresa. Su lógica real se prueba contra
// Postgres en la migración 20261006000000.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';

// ── Base en memoria ─────────────────────────────────────────────────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
/** Filtros aplicados en cada consulta a tablas de datos de una empresa. */
const dataQueries: { table: string; eqs: [string, unknown][] }[] = [];
/** Llamadas a funciones de Postgres. */
const rpcCalls: { fn: string; args: Row }[] = [];
// Tablas que no son "de una empresa": se buscan por la llave, no por tenant.
const KEYED_TABLES = new Set(['api_keys', 'idempotency_keys']);

class FakeQuery {
    private preds: ((r: Row) => boolean)[] = [];
    private eqs: [string, unknown][] = [];
    private max = Infinity;
    private single = false;
    private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
    private payload: Row | null = null;
    constructor(private table: string) {}
    select() { return this; }
    update(p: Row) { this.op = 'update'; this.payload = p; return this; }
    insert(p: Row) { this.op = 'insert'; this.payload = p; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c: string, v: unknown) { this.eqs.push([c, v]); this.preds.push(r => r[c] === v); return this; }
    is(c: string, v: unknown) { this.preds.push(r => (r[c] ?? null) === v); return this; }
    in(c: string, vs: unknown[]) { this.preds.push(r => vs.includes(r[c])); return this; }
    gt(c: string, v: number) { this.preds.push(r => Number(r[c]) > v); return this; }
    gte(c: string, v: string) { this.preds.push(r => r[c] >= v); return this; }
    lt(c: string, v: string) { this.preds.push(r => r[c] < v); return this; }
    or() { return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    then(ok?: (v: { data: any; error: any }) => unknown, ko?: (e: unknown) => unknown) {
        if (!KEYED_TABLES.has(this.table) && this.op !== 'insert') dataQueries.push({ table: this.table, eqs: this.eqs });
        const t = (tables[this.table] ??= []);
        let result: { data: any; error: any } = { data: null, error: null };
        if (this.op === 'insert') {
            const p = this.payload!;
            const dup = this.table === 'idempotency_keys' && t.some(r => r.api_key_id === p.api_key_id && r.key === p.key);
            if (dup) result = { data: null, error: { code: '23505', message: 'duplicate key' } };
            else t.push({ response_status: null, response_body: null, created_at: new Date().toISOString(), ...p });
        } else {
            const hits = t.filter(r => this.preds.every(p => p(r)));
            if (this.op === 'update') hits.forEach(r => Object.assign(r, this.payload));
            if (this.op === 'delete') tables[this.table] = t.filter(r => !hits.includes(r));
            result = { data: this.single ? (hits[0] ?? null) : hits.slice(0, this.max), error: null };
        }
        return Promise.resolve(result).then(ok, ko);
    }
}

const apiError = (code: string, msg: string) => ({ data: null, error: { message: `api_error:${code}:${msg}` } });

async function fakeRpc(fn: string, a: Row): Promise<{ data: any; error: any }> {
    rpcCalls.push({ fn, args: a });
    const inTenant = (table: string, id: string) => tables[table].find(r => r.id === id && r.tenant_id === a.p_tenant_id);
    if (fn === 'api_asset_holders') {
        return { data: tables.holders.filter(h => h.tenant_id === a.p_tenant_id && a.p_ids.includes(h.material_id)), error: null };
    }
    if (fn === 'api_create_asset') {
        const prev = tables.materials.find(m => m.tenant_id === a.p_tenant_id && m.external_ref === a.p_external_ref);
        if (prev) return { data: [{ asset_id: prev.id, created: false }], error: null };
        const tpl = inTenant('materials', a.p_template_id);
        if (!tpl) return apiError('not_found', 'El material_id no existe en esta empresa.');
        if (a.p_warehouse_id && !inTenant('warehouses', a.p_warehouse_id)) return apiError('not_found', 'El panol_id no existe.');
        const id = randomUUID();
        tables.materials.push({ ...tpl, id, stock: 1, catalog_material_id: tpl.id, external_ref: a.p_external_ref, updated_at: new Date().toISOString() });
        return { data: [{ asset_id: id, created: true }], error: null };
    }
    if (fn === 'api_stock_entry') {
        const ref = a.p_kind === 'reverso' ? `${a.p_external_ref}#reverso` : a.p_external_ref;
        const prev = tables.stock_movements.find(m => m.tenant_id === a.p_tenant_id && m.external_ref === ref);
        if (prev) return { data: [{ movement_id: prev.id, created: false, material_id: prev.material_id, stock: 0 }], error: null };
        const mat = inTenant('materials', a.p_material_id);
        if (!mat) return apiError('not_found', 'El material_id no existe en esta empresa.');
        mat.stock += a.p_qty;
        const id = randomUUID();
        tables.stock_movements.push({ id, tenant_id: a.p_tenant_id, material_id: mat.id, quantity_change: a.p_qty, external_ref: ref });
        return { data: [{ movement_id: id, created: true, material_id: mat.id, stock: mat.stock }], error: null };
    }
    throw new Error(`rpc no emulada: ${fn}`);
}

const fakeDb = { from: (t: string) => new FakeQuery(t), rpc: fakeRpc };

vi.mock('@/modules/core/lib/supabase', () => ({ getSupabaseAdmin: () => fakeDb, supabase: fakeDb }));
vi.mock('@/modules/core/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }));

// ── Datos de dos empresas ───────────────────────────────────────────────────
const A = 'aaaaaaaa-0000-4000-8000-000000000000';
const B = 'bbbbbbbb-0000-4000-8000-000000000000';
const uid = (t: string, n: number) => `${t.slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;

function material(tenant: string, n: number, usage_type: string): Row {
    return {
        id: uid(tenant, n), tenant_id: tenant, name: `Material ${n}`, internal_code: `C-${n}`, serial_number: null,
        description: null, category: 'General', unit: 'Unidad', stock: 5, min_stock: 1, archived: false, deleted_at: null,
        usage_type, ownership: 'propio', supplier_id: null, status: 'Disponible', location: null, unit_cost: 1000,
        acquisition_date: null, catalog_material_id: null, external_ref: null, updated_at: `2026-07-0${n}T00:00:00+00:00`,
    };
}
function supplier(tenant: string, n: number): Row {
    return { id: uid(tenant, 100 + n), tenant_id: tenant, rut: '76.111.222-3', name: `Proveedor ${n}`, email: null, phone: null, deleted_at: null, updated_at: '2026-07-01T00:00:00+00:00' };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const KEY = {
    A: 'pk_test_' + 'a'.repeat(64),
    B: 'pk_test_' + 'b'.repeat(64),
    A_SOLO_MATERIALES: 'pk_test_' + 'c'.repeat(64),
    A_REVOCADA: 'pk_test_' + 'd'.repeat(64),
};
const READ = ['materiales:read', 'productos:read', 'proveedores:read', 'activos:read'];
const ALL = [...READ, 'activos:write', 'stock:write'];

beforeEach(() => {
    dataQueries.length = 0;
    rpcCalls.length = 0;
    // Mismos códigos y nombres en ambas empresas: sólo el tenant los distingue.
    tables.materials = [A, B].flatMap(t => [material(t, 1, 'Consumible'), material(t, 2, 'Herramienta Menor'), material(t, 3, 'Activo Fijo')]);
    tables.suppliers = [A, B].flatMap(t => [supplier(t, 1), supplier(t, 2)]);
    tables.warehouses = [A, B].map((t, i) => ({ id: uid(t, 50), tenant_id: t, name: `Pañol ${i}`, location: null, status: 'active' }));
    tables.warehouse_contracts = [];
    tables.contracts = [];
    tables.material_stocks = [A, B].map(t => ({ tenant_id: t, material_id: uid(t, 2), warehouse_id: uid(t, 50), contract_id: null, qty: 1 }));
    tables.holders = [];
    tables.stock_movements = [];
    tables.idempotency_keys = [];
    tables.api_keys = [
        { id: 'k-a', tenant_id: A, name: 'A', key_hash: sha(KEY.A), scopes: ALL, revoked_at: null, last_used_at: null },
        { id: 'k-b', tenant_id: B, name: 'B', key_hash: sha(KEY.B), scopes: ALL, revoked_at: null, last_used_at: null },
        { id: 'k-c', tenant_id: A, name: 'C', key_hash: sha(KEY.A_SOLO_MATERIALES), scopes: ['materiales:read'], revoked_at: null, last_used_at: null },
        { id: 'k-d', tenant_id: A, name: 'D', key_hash: sha(KEY.A_REVOCADA), scopes: ALL, revoked_at: '2026-07-01T00:00:00Z', last_used_at: null },
    ];
});

// ── Endpoints ───────────────────────────────────────────────────────────────
type Handler = (req: Request, ctx?: any) => Promise<Response>;
const ENDPOINTS: { path: string; table: string; list: () => Promise<Handler>; detail: () => Promise<Handler> }[] = [
    { path: 'materiales', table: 'materials', list: async () => (await import('@/app/api/v1/materiales/route')).GET, detail: async () => (await import('@/app/api/v1/materiales/[id]/route')).GET },
    { path: 'productos', table: 'materials', list: async () => (await import('@/app/api/v1/productos/route')).GET, detail: async () => (await import('@/app/api/v1/productos/[id]/route')).GET },
    { path: 'proveedores', table: 'suppliers', list: async () => (await import('@/app/api/v1/proveedores/route')).GET, detail: async () => (await import('@/app/api/v1/proveedores/[id]/route')).GET },
    { path: 'activos', table: 'materials', list: async () => (await import('@/app/api/v1/activos/route')).GET, detail: async () => (await import('@/app/api/v1/activos/[id]/route')).GET },
];

const req = (path: string, key?: string, init: { method?: string; body?: unknown; idem?: string | null } = {}) => {
    const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.idem !== null && init.method && init.method !== 'GET') headers['idempotency-key'] = init.idem ?? randomUUID();
    return new Request(`https://pagnol.test/api/v1/${path}`, {
        method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const noParams = { params: Promise.resolve({}) };

/** Un id del recurso en la empresa dada, tomado de su propio listado. */
async function someId(list: Handler, path: string, key: string): Promise<string> {
    const body = await (await list(req(`${path}?limit=100`, key))).json();
    return body.data[0].id;
}

function expectAllScopedTo(tenant: string) {
    expect(dataQueries.length + rpcCalls.length).toBeGreaterThan(0);
    for (const q of dataQueries) expect(q.eqs, `consulta a ${q.table} sin filtro de empresa`).toContainEqual(['tenant_id', tenant]);
    for (const c of rpcCalls) expect(c.args.p_tenant_id, `rpc ${c.fn}`).toBe(tenant);
}

describe.each(ENDPOINTS)('GET /$path — aislamiento entre empresas', ({ path, table, list, detail }) => {
    it('el listado sólo trae filas de la empresa de la llave', async () => {
        for (const [key, tenant] of [[KEY.A, A], [KEY.B, B]] as const) {
            const res = await (await list())(req(`${path}?limit=100`, key));
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.length).toBeGreaterThan(0);
            const own = new Set(tables[table].filter(r => r.tenant_id === tenant).map(r => r.id));
            for (const item of body.data) expect(own.has(item.id)).toBe(true);
        }
    });

    it('toda consulta a la base lleva el filtro de la empresa', async () => {
        await (await list())(req(`${path}?limit=100`, KEY.A));
        await (await detail())(req(`${path}/x`, KEY.A), params(uid(A, 2)));
        expectAllScopedTo(A);
    });

    it('el detalle de un recurso de OTRA empresa responde 404', async () => {
        const idDeB = await someId(await list(), path, KEY.B);
        const res = await (await detail())(req(`${path}/${idDeB}`, KEY.A), params(idDeB));
        expect(res.status).toBe(404);
        expect((await res.json()).error.code).toBe('not_found');

        const ok = await (await detail())(req(`${path}/${idDeB}`, KEY.B), params(idDeB));
        expect(ok.status).toBe(200);
        expect((await ok.json()).id).toBe(idDeB);
    });

    it('sin llave o con llave revocada responde 401', async () => {
        for (const key of [undefined, KEY.A_REVOCADA, 'pk_test_noexiste', 'pk_test_' + 'e'.repeat(64)]) {
            const res = await (await list())(req(path, key));
            expect(res.status).toBe(401);
            expect((await res.json()).error.code).toBe('unauthorized');
        }
    });

    it('un id que no es uuid responde 400', async () => {
        const res = await (await detail())(req(`${path}/123`, KEY.A), params('123'));
        expect(res.status).toBe(400);
        expect((await res.json()).error.code).toBe('validation_error');
    });
});

describe('dónde está — aislamiento', () => {
    it('el activo trae su pañol y responsable, sólo de su empresa', async () => {
        tables.holders = [{ tenant_id: B, material_id: uid(A, 2), holder_name: 'Intruso de B' }];
        const { GET } = await import('@/app/api/v1/activos/[id]/route');
        const res = await GET(req('activos/x', KEY.A) as any, params(uid(A, 2)));
        const body = await res.json();
        expect(body.panol).toEqual({ id: uid(A, 50), nombre: 'Pañol 0' });
        expect(body.responsable).toBeNull(); // el "responsable" registrado bajo la empresa B no se filtra
        expectAllScopedTo(A);
    });

    it('/panoles sólo lista los de la empresa', async () => {
        const { GET } = await import('@/app/api/v1/panoles/route');
        const body = await (await GET(req('panoles', KEY.A) as any)).json();
        expect(body.data.map((p: Row) => p.id)).toEqual([uid(A, 50)]);
        expectAllScopedTo(A);
    });

    it('/materiales/{id}/existencias de OTRA empresa responde 404', async () => {
        const { GET } = await import('@/app/api/v1/materiales/[id]/existencias/route');
        expect((await GET(req('x', KEY.A) as any, params(uid(B, 2)))).status).toBe(404);
        const own = await (await GET(req('x', KEY.A) as any, params(uid(A, 2)))).json();
        expect(own.existencias).toEqual([{ panol: { id: uid(A, 50), nombre: 'Pañol 0' }, contrato: null, cantidad: 1 }]);
        expectAllScopedTo(A);
    });
});

describe('escritura — aislamiento', () => {
    const crear = (key: string, body: Row, idem?: string) =>
        import('@/app/api/v1/activos/route').then(m => m.POST(req('activos', key, { method: 'POST', body, idem }) as any, noParams as any));

    it('POST /activos con un ítem de OTRA empresa responde 404 y no crea nada', async () => {
        const antes = tables.materials.length;
        const res = await crear(KEY.A, { material_id: uid(B, 2), external_ref: 'r1' });
        expect(res.status).toBe(404);
        expect(tables.materials.length).toBe(antes);
        expectAllScopedTo(A);
    });

    it('POST /activos crea en la empresa de la llave; repetir la referencia no duplica', async () => {
        const res = await crear(KEY.A, { material_id: uid(A, 2), external_ref: 'r2', panol_id: uid(A, 50) });
        expect(res.status).toBe(201);
        const activo = await res.json();
        expect(tables.materials.find(m => m.id === activo.id)?.tenant_id).toBe(A);
        expect(activo.material_id).toBe(uid(A, 2));
        const again = await crear(KEY.A, { material_id: uid(A, 2), external_ref: 'r2', panol_id: uid(A, 50) });
        expect(again.status).toBe(200);
        expect((await again.json()).id).toBe(activo.id);
        expectAllScopedTo(A);
    });

    it('PATCH /activos/{id} de OTRA empresa responde 404 y no lo toca', async () => {
        const { PATCH } = await import('@/app/api/v1/activos/[id]/route');
        const res = await PATCH(req('activos/x', KEY.A, { method: 'PATCH', body: { estado: 'extraviado' } }) as any, params(uid(B, 2)));
        expect(res.status).toBe(404);
        expect(tables.materials.find(m => m.id === uid(B, 2))?.status).toBe('Disponible');

        const own = await PATCH(req('activos/x', KEY.A, { method: 'PATCH', body: { estado: 'extraviado' } }) as any, params(uid(A, 2)));
        expect(own.status).toBe(200);
        expect((await own.json()).estado).toBe('extraviado');
        expectAllScopedTo(A);
    });

    it('POST /movimientos con un material de OTRA empresa responde 404', async () => {
        const { POST } = await import('@/app/api/v1/movimientos/route');
        const body = { tipo: 'ingreso', material_id: uid(B, 1), cantidad: 3, external_ref: 'm1' };
        const res = await POST(req('movimientos', KEY.A, { method: 'POST', body }) as any, noParams as any);
        expect(res.status).toBe(404);
        expect(tables.materials.find(m => m.id === uid(B, 1))?.stock).toBe(5);
        expectAllScopedTo(A);
    });

    it('las escrituras exigen su scope', async () => {
        tables.api_keys[0].scopes = READ;
        expect((await crear(KEY.A, { material_id: uid(A, 2), external_ref: 'r3' })).status).toBe(403);
        const { POST } = await import('@/app/api/v1/movimientos/route');
        const body = { tipo: 'ingreso', material_id: uid(A, 1), cantidad: 1, external_ref: 'm2' };
        expect((await POST(req('movimientos', KEY.A, { method: 'POST', body }) as any, noParams as any)).status).toBe(403);
    });
});

describe('idempotencia', () => {
    const crear = (body: Row, idem?: string | null) =>
        import('@/app/api/v1/activos/route').then(m => m.POST(req('activos', KEY.A, { method: 'POST', body, idem }) as any, noParams as any));

    it('misma llave y mismo cuerpo: misma respuesta, se ejecuta una sola vez', async () => {
        const idem = randomUUID();
        const body = { material_id: uid(A, 2), external_ref: 'i1' };
        const first = await crear(body, idem);
        // Mismo cuerpo con otro orden de campos.
        const second = await crear({ external_ref: 'i1', material_id: uid(A, 2) }, idem);
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.headers.get('Idempotent-Replayed')).toBe('true');
        expect(await second.json()).toEqual(await first.json());
        expect(rpcCalls.filter(c => c.fn === 'api_create_asset')).toHaveLength(1);
    });

    it('misma llave con otro cuerpo responde 409 idempotency_conflict', async () => {
        const idem = randomUUID();
        await crear({ material_id: uid(A, 2), external_ref: 'i2' }, idem);
        const res = await crear({ material_id: uid(A, 2), external_ref: 'otra' }, idem);
        expect(res.status).toBe(409);
        expect((await res.json()).error.code).toBe('idempotency_conflict');
    });

    it('sin Idempotency-Key responde 400', async () => {
        const res = await crear({ material_id: uid(A, 2), external_ref: 'i3' }, null);
        expect(res.status).toBe(400);
        expect((await res.json()).error.message).toMatch(/Idempotency-Key/);
    });

    it('un error no queda guardado: corregido el problema, la misma llave funciona', async () => {
        const idem = randomUUID();
        const body = { material_id: uid(A, 2), external_ref: 'i4', panol_id: uid(A, 51) };
        expect((await crear(body, idem)).status).toBe(404); // pañol aún no existe
        tables.warehouses.push({ id: uid(A, 51), tenant_id: A, name: 'Pañol nuevo', location: null, status: 'active' });
        expect((await crear(body, idem)).status).toBe(201);
    });

    it('un cuerpo inválido responde 400 con el detalle por campo', async () => {
        const res = await crear({ material_id: 'no-uuid', external_ref: '' });
        expect(res.status).toBe(400);
        const { error } = await res.json();
        expect(Object.keys(error.details.fields)).toEqual(expect.arrayContaining(['material_id', 'external_ref']));
    });
});

describe('scopes', () => {
    it('una llave sin el scope recibe 403; con el scope, 200', async () => {
        for (const ep of ENDPOINTS) {
            const res = await (await ep.list())(req(ep.path, KEY.A_SOLO_MATERIALES));
            expect(res.status).toBe(ep.path === 'materiales' ? 200 : 403);
            if (res.status === 403) expect((await res.json()).error.code).toBe('forbidden');
        }
    });

    it('limit fuera de rango responde 400', async () => {
        const res = await (await ENDPOINTS[0].list())(req('materiales?limit=500', KEY.A));
        expect(res.status).toBe(400);
    });
});
