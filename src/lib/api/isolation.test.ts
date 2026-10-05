// @vitest-environment node
//
// Aislamiento entre empresas de la API pública v1. Los endpoints corren con el
// cliente service role (sin RLS): si alguno olvida filtrar por la empresa de
// la API key, aquí devuelve filas de la otra empresa y el test falla.
//
// Se reemplaza Supabase por una base en memoria que aplica de verdad los
// filtros de igualdad (eq / is / in / gte / limit). Los filtros `or` (búsqueda,
// cursor, tipo de producto) se registran pero no se aplican: eso sólo agranda
// el resultado, así que no puede ocultar una fuga.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

// ── Base en memoria ─────────────────────────────────────────────────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
/** Filtros aplicados en cada consulta a tablas de datos (no `api_keys`). */
const dataQueries: { table: string; eqs: [string, unknown][] }[] = [];

class FakeQuery {
    private preds: ((r: Row) => boolean)[] = [];
    private eqs: [string, unknown][] = [];
    private max = Infinity;
    private single = false;
    private patch: Row | null = null;
    constructor(private table: string) {}
    select() { return this; }
    update(p: Row) { this.patch = p; return this; }
    eq(c: string, v: unknown) { this.eqs.push([c, v]); this.preds.push(r => r[c] === v); return this; }
    is(c: string, v: unknown) { this.preds.push(r => (r[c] ?? null) === v); return this; }
    in(c: string, vs: unknown[]) { this.preds.push(r => vs.includes(r[c])); return this; }
    gte(c: string, v: string) { this.preds.push(r => r[c] >= v); return this; }
    or() { return this; }
    order() { return this; }
    limit(n: number) { this.max = n; return this; }
    maybeSingle() { this.single = true; return this; }
    then(ok?: (v: { data: any; error: null }) => unknown, ko?: (e: unknown) => unknown) {
        if (this.table !== 'api_keys') dataQueries.push({ table: this.table, eqs: this.eqs });
        const hits = (tables[this.table] ?? []).filter(r => this.preds.every(p => p(r)));
        if (this.patch) hits.forEach(r => Object.assign(r, this.patch));
        const data = this.single ? (hits[0] ?? null) : hits.slice(0, this.max);
        return Promise.resolve({ data, error: null as null }).then(ok, ko);
    }
}
const fakeDb = { from: (t: string) => new FakeQuery(t) };

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
        acquisition_date: null, updated_at: `2026-07-0${n}T00:00:00+00:00`,
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
const ALL = ['materiales:read', 'productos:read', 'proveedores:read', 'activos:read'];

beforeEach(() => {
    dataQueries.length = 0;
    // Mismos códigos y nombres en ambas empresas: sólo el tenant los distingue.
    tables.materials = [A, B].flatMap(t => [material(t, 1, 'Consumible'), material(t, 2, 'Herramienta Menor'), material(t, 3, 'Activo Fijo')]);
    tables.suppliers = [A, B].flatMap(t => [supplier(t, 1), supplier(t, 2)]);
    tables.api_keys = [
        { id: 'k-a', tenant_id: A, key_hash: sha(KEY.A), scopes: ALL, revoked_at: null, last_used_at: null },
        { id: 'k-b', tenant_id: B, key_hash: sha(KEY.B), scopes: ALL, revoked_at: null, last_used_at: null },
        { id: 'k-c', tenant_id: A, key_hash: sha(KEY.A_SOLO_MATERIALES), scopes: ['materiales:read'], revoked_at: null, last_used_at: null },
        { id: 'k-d', tenant_id: A, key_hash: sha(KEY.A_REVOCADA), scopes: ALL, revoked_at: '2026-07-01T00:00:00Z', last_used_at: null },
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

const req = (path: string, key?: string) =>
    new Request(`https://pagnol.test/api/v1/${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Un id del recurso en la empresa dada, tomado de su propio listado. */
async function someId(list: Handler, path: string, key: string): Promise<string> {
    const body = await (await list(req(`${path}?limit=100`, key))).json();
    return body.data[0].id;
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
        await (await detail())(req(`${path}/x`, KEY.A), params(uid(A, 1)));
        expect(dataQueries.length).toBeGreaterThan(0);
        for (const q of dataQueries) expect(q.eqs).toContainEqual(['tenant_id', A]);
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
