// @vitest-environment node
//
// Webhooks de la API pública: firma Standard Webhooks, freno de URLs, backoff
// y el despachador (armado del sobre, agrupación, entrega y reintentos).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_AGE_MS, RETRY_DELAYS_MS, planRetry } from './events';
import { generateWebhookSecret, signedHeaders, verifyWebhook } from './sign';
import { isPrivateIp, webhookUrlProblem } from './url-guard';

// ── Firma ───────────────────────────────────────────────────────────────────
describe('firma Standard Webhooks', () => {
    // Vector de la especificación; también lo firma igual la librería oficial `standardwebhooks`.
    const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    const ID = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
    const BODY = '{"test": 2432232314}';

    it('firma igual que la especificación', () => {
        const h = signedHeaders(SECRET, ID, BODY, 1614265330_000);
        expect(h['webhook-signature']).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
        expect(h['webhook-id']).toBe(ID);
        expect(h['webhook-timestamp']).toBe('1614265330');
        expect(h['content-type']).toBe('application/json');
    });

    it('el receptor acepta lo firmado y rechaza cuerpo, id o secreto alterados', () => {
        const now = Date.now();
        const h = signedHeaders(SECRET, ID, BODY, now);
        expect(verifyWebhook(SECRET, h, BODY, now)).toBe(true);
        expect(verifyWebhook(SECRET, h, BODY + ' ', now)).toBe(false);
        expect(verifyWebhook(SECRET, { ...h, 'webhook-id': 'otro' }, BODY, now)).toBe(false);
        expect(verifyWebhook(generateWebhookSecret(), h, BODY, now)).toBe(false);
    });

    it('rechaza un timestamp con más de 5 minutos de diferencia', () => {
        const now = Date.now();
        const h = signedHeaders(SECRET, ID, BODY, now - 6 * 60_000);
        expect(verifyWebhook(SECRET, h, BODY, now)).toBe(false);
        expect(verifyWebhook(SECRET, signedHeaders(SECRET, ID, BODY, now - 4 * 60_000), BODY, now)).toBe(true);
    });

    it('los secretos generados son whsec_ + 32 bytes en base64 y no se repiten', () => {
        const a = generateWebhookSecret();
        expect(a).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
        expect(Buffer.from(a.slice(6), 'base64')).toHaveLength(32);
        expect(generateWebhookSecret()).not.toBe(a);
    });
});

// ── URLs ────────────────────────────────────────────────────────────────────
describe('URL de destino', () => {
    it('acepta https público, con su barra final', () => {
        expect(webhookUrlProblem('https://plataforma.grupovalar.cl/api/webhooks/pagnol/')).toBeNull();
        expect(webhookUrlProblem('https://plataforma.grupovalar.cl/api/webhooks/pagnol')).toBeNull();
        expect(webhookUrlProblem('https://hooks.example.com:443/x')).toBeNull();
    });

    it.each([
        ['http://plataforma.grupovalar.cl/x', 'http'],
        ['https://localhost/x', 'localhost'],
        ['https://api.localhost/x', 'subdominio de localhost'],
        ['https://intranet/x', 'sin punto'],
        ['https://servidor.local/x', '.local'],
        ['https://db.internal/x', '.internal'],
        ['https://127.0.0.1/x', 'loopback'],
        ['https://10.1.2.3/x', 'privada'],
        ['https://169.254.169.254/latest/meta-data', 'metadatos de la nube'],
        ['https://192.168.0.5/x', 'privada'],
        ['https://[::1]/x', 'loopback IPv6'],
        ['https://[fd00::1]/x', 'IPv6 local'],
        ['https://user:pass@example.com/x', 'credenciales'],
        ['https://example.com:8443/x', 'puerto'],
        ['https://example.com/x#frag', 'fragmento'],
        ['ftp://example.com/x', 'ftp'],
        ['no es una url', 'basura'],
    ])('rechaza %s (%s)', (url) => {
        expect(webhookUrlProblem(url)).not.toBeNull();
    });

    it('reconoce las direcciones no públicas', () => {
        for (const ip of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '224.0.0.1', '::1', 'fe80::1', '::ffff:10.0.0.1']) {
            expect(isPrivateIp(ip), ip).toBe(true);
        }
        for (const ip of ['8.8.8.8', '172.32.0.1', '100.63.0.1', '200.14.0.1', '2606:4700::1111']) {
            expect(isPrivateIp(ip), ip).toBe(false);
        }
    });
});

// ── Reintentos ──────────────────────────────────────────────────────────────
describe('backoff de reintentos', () => {
    const created = new Date('2026-10-19T12:00:00Z');
    const plan = (failed: number, ageMs = 0) => planRetry(failed, created, new Date(created.getTime() + ageMs));

    it('sigue la escala del contrato: 1 min, 5 min, 30 min, 2 h, 6 h, 24 h', () => {
        const delays = [1, 2, 3, 4, 5, 6].map(n => {
            const p = plan(n);
            if (p.status !== 'pending') throw new Error('debía reintentar');
            return p.nextAttemptAt.getTime() - created.getTime();
        });
        expect(delays).toEqual([...RETRY_DELAYS_MS]);
        expect(delays).toEqual([1, 5, 30, 120, 360, 1440].map(m => m * 60_000));
    });

    it('pasado el último escalón se sigue cada 24 h', () => {
        const p = plan(9, 3 * 24 * 3_600_000);
        expect(p.status).toBe('pending');
        if (p.status === 'pending') expect(p.nextAttemptAt.getTime() - (created.getTime() + 3 * 24 * 3_600_000)).toBe(24 * 3_600_000);
    });

    it('a los 7 días la entrega se da por fallida', () => {
        expect(plan(7, MAX_AGE_MS - 3_600_000).status).toBe('failed'); // el próximo intento ya pasaría de 7 días
        expect(plan(2, MAX_AGE_MS + 1).status).toBe('failed');
    });
});

// ── Despachador ─────────────────────────────────────────────────────────────
const T = 'aaaaaaaa-0000-4000-8000-000000000000';
const M1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const S1 = 'aaaaaaaa-0000-4000-8000-000000000002';
const P9 = 'aaaaaaaa-0000-4000-8000-000000000009';

const queries = vi.hoisted(() => ({
    activeWebhookTargets: vi.fn(),
    materialesByIds: vi.fn(),
    activosByIds: vi.fn(),
    proveedoresByIds: vi.fn(),
    comprasRecibidasByIds: vi.fn(),
    comprasCorregidasByIds: vi.fn(),
    solicitudesCompraByIds: vi.fn(),
    getExistencias: vi.fn(),
}));
vi.mock('../queries', () => queries);

import { deliverDue, fanOut, runDispatch, type DispatchReport } from './dispatch';

interface Rec { table: string; op: string; payload: any; filters: [string, unknown][] }
let log: Rec[];
let rpcResults: Record<string, unknown>;

const fakeDb: any = {
    rpc: async (fn: string) => ({ data: rpcResults[fn] ?? [], error: null }),
    from: (table: string) => {
        const rec: Rec = { table, op: '', payload: null, filters: [] };
        const q: any = {
            update(p: unknown) { rec.op = 'update'; rec.payload = p; return q; },
            upsert(p: unknown) { rec.op = 'upsert'; rec.payload = p; return q; },
            eq(c: string, v: unknown) { rec.filters.push([c, v]); return q; },
            in(c: string, v: unknown) { rec.filters.push([c, v]); return q; },
            then(ok: any, ko: any) { log.push(rec); return Promise.resolve({ data: null, error: null }).then(ok, ko); },
        };
        return q;
    },
};

const emptyReport = (): DispatchReport => ({ events: 0, coalesced: 0, deliveries: { sent: 0, delivered: 0, retrying: 0, failed: 0 }, purged: 0 });
const mat = (id: string, extra: Record<string, unknown> = {}) => ({ id, codigo: 'C', nombre: 'Guantes', stock_actual: 9, stock_minimo: 5, activo: true, ...extra });
const ev = (id: string, type: string, resource_id: string, at: string, detail: unknown = null) =>
    ({ id, tenant_id: T, type, resource_id, detail, created_at: at });

beforeEach(() => {
    log = [];
    rpcResults = {};
    Object.values(queries).forEach(f => f.mockReset());
    queries.activeWebhookTargets.mockResolvedValue([{ id: 'sub-1', events: ['material.actualizado', 'stock.bajo_minimo'] }]);
    queries.materialesByIds.mockImplementation(async (_db, _t, _k, ids: string[]) => ids.map(id => mat(id)));
    queries.activosByIds.mockResolvedValue([]);
    queries.proveedoresByIds.mockResolvedValue([]);
    queries.comprasRecibidasByIds.mockResolvedValue(new Map());
    queries.comprasCorregidasByIds.mockResolvedValue(new Map());
    queries.solicitudesCompraByIds.mockResolvedValue(new Map());
    queries.getExistencias.mockResolvedValue({ material_id: S1, stock_actual: 3, existencias: [{ panol: { id: 'p1', nombre: 'Pañol 1' }, contrato: null, cantidad: 3 }] });
});

describe('despachador — de eventos a entregas', () => {
    it('arma el sobre, agrupa repeticiones y sólo entrega a quien escucha', async () => {
        rpcResults.webhooks_claim_events = [
            ev('evt_1', 'material.actualizado', M1, '2026-10-19T12:00:00Z'),
            ev('evt_2', 'material.actualizado', M1, '2026-10-19T12:00:30Z'), // el mismo recurso, más nuevo
            ev('evt_3', 'stock.bajo_minimo', S1, '2026-10-19T12:00:40Z', { stock_actual: 3, stock_minimo: 5 }),
            ev('evt_4', 'proveedor.creado', P9, '2026-10-19T12:00:50Z'),     // nadie lo escucha
        ];
        const report = emptyReport();
        expect(await fanOut(fakeDb, report)).toBe(4);
        expect(report.coalesced).toBe(1);

        const upserts = log.filter(r => r.op === 'upsert').flatMap(r => r.payload);
        expect(upserts).toEqual([
            { tenant_id: T, event_id: 'evt_2', subscription_id: 'sub-1' },
            { tenant_id: T, event_id: 'evt_3', subscription_id: 'sub-1' },
        ]);

        const notes = log.filter(r => r.table === 'webhook_events' && r.payload.note).map(r => [r.filters[0][1], r.payload.note]);
        expect(notes).toEqual(expect.arrayContaining([
            [['evt_1'], expect.stringContaining('agrupado')],
            [['evt_4'], expect.stringContaining('sin suscripciones')],
        ]));

        const payloadOf = (id: string) => log.find(r => r.table === 'webhook_events' && r.payload.payload && r.filters[0][1] === id)!.payload.payload;
        expect(payloadOf('evt_2')).toEqual({
            id: 'evt_2', type: 'material.actualizado', created_at: '2026-10-19T12:00:30.000Z',
            organization_id: T, data: mat(M1),
        });
        // stock.bajo_minimo: el stock del instante, y el desglose por pañol.
        const stock = payloadOf('evt_3');
        expect(stock.organization_id).toBe(T);
        expect(stock.data).toMatchObject({ id: S1, stock_actual: 3, stock_minimo: 5 });
        expect(stock.data.existencias).toEqual([{ panol: { id: 'p1', nombre: 'Pañol 1' }, contrato: null, cantidad: 3 }]);
    });

    it('un recurso que ya no existe no genera entrega ni se reintenta eternamente', async () => {
        rpcResults.webhooks_claim_events = [ev('evt_9', 'material.actualizado', M1, '2026-10-19T12:00:00Z')];
        queries.materialesByIds.mockResolvedValue([]);
        await fanOut(fakeDb, emptyReport());
        expect(log.some(r => r.op === 'upsert')).toBe(false);
        expect(log.find(r => r.table === 'webhook_events')!.payload.note).toContain('ya no está disponible');
    });

    it('sin eventos pendientes no hace nada', async () => {
        expect(await fanOut(fakeDb, emptyReport())).toBe(0);
        expect(log).toHaveLength(0);
    });
});

describe('despachador — entrega y reintentos', () => {
    const NOW = new Date('2026-10-19T12:10:00Z');
    const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    const payload = { id: 'evt_1', type: 'material.actualizado', created_at: '2026-10-19T12:00:00.000Z', organization_id: T, data: mat(M1) };
    const delivery = (id: string, attempts = 0, createdAt = '2026-10-19T12:05:00Z', extra: Record<string, unknown> = {}) =>
        ({ id, tenant_id: T, event_id: 'evt_1', subscription_id: 'sub-1', attempts, created_at: createdAt, url: 'https://plataforma.grupovalar.cl/api/webhooks/pagnol/', secret: SECRET, payload, ...extra });
    const patchOf = (id: string) => log.find(r => r.table === 'webhook_deliveries' && r.filters.some(f => f[0] === 'id' && f[1] === id))!.payload;
    const deps = (fetchImpl: any, checkHost: any = async () => null) => ({ fetch: fetchImpl, now: () => NOW, checkHost });

    it('envía firmado a la URL exacta, con la barra final, sin seguir redirecciones', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1')];
        const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
        const report = emptyReport();
        await deliverDue(fakeDb, deps(fetchMock), report);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://plataforma.grupovalar.cl/api/webhooks/pagnol/');
        expect(init.method).toBe('POST');
        expect(init.redirect).toBe('manual');
        const headers = init.headers as Record<string, string>;
        expect(headers['webhook-id']).toBe('evt_1');
        expect(init.body).toBe(JSON.stringify(payload));
        // Lo que recibe Valar se verifica con el secreto de la suscripción.
        expect(verifyWebhook(SECRET, headers, init.body as string, NOW.getTime())).toBe(true);
        expect(patchOf('d1')).toMatchObject({ status: 'delivered', attempts: 1, last_status: 200, last_error: null });
        expect(report.deliveries).toEqual({ sent: 1, delivered: 1, retrying: 0, failed: 0 });
    });

    it('un fallo se reintenta con el backoff del contrato; el timestamp se rehace en cada intento', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1', 0), delivery('d2', 2), delivery('d3', 5)];
        const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
        const report = emptyReport();
        await deliverDue(fakeDb, deps(fetchMock), report);

        const minutes = (id: string) => (Date.parse(patchOf(id).next_attempt_at) - NOW.getTime()) / 60_000;
        expect(minutes('d1')).toBe(1);      // 1.er fallo
        expect(minutes('d2')).toBe(30);     // 3.er fallo
        expect(minutes('d3')).toBe(1440);   // 6.º fallo
        expect(patchOf('d1')).toMatchObject({ attempts: 1, last_status: 500, last_error: 'Respondió HTTP 500.' });
        expect(patchOf('d1').status).toBeUndefined(); // sigue pendiente
        expect(report.deliveries).toMatchObject({ retrying: 3, delivered: 0, failed: 0 });
    });

    it('una redirección es un fallo y dice a dónde apuntaba', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1')];
        const fetchMock = vi.fn(async () => new Response(null, { status: 308, headers: { location: 'https://plataforma.grupovalar.cl/api/webhooks/pagnol' } }));
        await deliverDue(fakeDb, deps(fetchMock), emptyReport());
        expect(patchOf('d1').last_error).toContain('redirige a https://plataforma.grupovalar.cl/api/webhooks/pagnol');
        expect(patchOf('d1').next_attempt_at).toBeDefined();
    });

    it('sin respuesta (timeout) o con la red caída también se reintenta', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1'), delivery('d2')];
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
            .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND'));
        await deliverDue(fakeDb, deps(fetchMock), emptyReport());
        expect(patchOf('d1')).toMatchObject({ last_status: null, last_error: 'Sin respuesta en 10 s.' });
        expect(patchOf('d2').last_error).toContain('ENOTFOUND');
    });

    it('a los 7 días sin éxito la entrega queda fallida', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1', 9, '2026-10-12T11:00:00Z')];
        const report = emptyReport();
        await deliverDue(fakeDb, deps(vi.fn(async () => new Response(null, { status: 502 }))), report);
        expect(patchOf('d1')).toMatchObject({ status: 'failed', attempts: 10 });
        expect(report.deliveries.failed).toBe(1);
    });

    it('no envía a una URL que apunta a la red interna', async () => {
        rpcResults.webhooks_claim_deliveries = [delivery('d1', 0, '2026-10-19T12:05:00Z', { url: 'https://interno.example.com/x' })];
        const fetchMock = vi.fn();
        await deliverDue(fakeDb, deps(fetchMock, async () => 'El dominio apunta a una red interna.'), emptyReport());
        expect(fetchMock).not.toHaveBeenCalled();
        expect(patchOf('d1').last_error).toBe('El dominio apunta a una red interna.');
    });

    it('un pulso completo termina cuando no queda nada por hacer', async () => {
        rpcResults.webhooks_claim_events = [];
        rpcResults.webhooks_claim_deliveries = [];
        const report = await runDispatch(fakeDb, deps(vi.fn()), 5_000);
        expect(report).toMatchObject({ events: 0, deliveries: { sent: 0 } });
    });
});
