import type { SupabaseClient } from '@supabase/supabase-js';
import {
    activeWebhookTargets, activosByIds, getExistencias, materialesByIds, proveedoresByIds,
} from '../queries';
import { eventResource, planRetry, type WebhookEventType } from './events';
import { signedHeaders } from './sign';
import { resolvedHostProblem } from './url-guard';

// Despachador de webhooks. Lo ejecuta /api/cron/webhooks en cada pulso:
//   1. Toma los eventos nuevos del outbox (`webhook_events`, escritos por
//      triggers), arma el sobre con el MISMO DTO que devuelve la API y crea una
//      entrega por suscripción interesada.
//   2. Envía las entregas vencidas, firmadas, y reintenta las que fallan.
// Cada paso es seguro de repetir: lo tomado lleva un plazo (lease) y las
// entregas son únicas por (evento, suscripción).

export const SEND_TIMEOUT_MS = 10_000;
const CLAIM_EVENTS = 200;
const CLAIM_DELIVERIES = 50;
const SEND_CONCURRENCY = 8;

interface EventRow {
    id: string;
    tenant_id: string;
    type: WebhookEventType;
    resource_id: string;
    detail: { stock_actual?: number; stock_minimo?: number } | null;
    created_at: string;
}

export interface Envelope {
    id: string;
    type: WebhookEventType;
    created_at: string;
    organization_id: string;
    data: Record<string, unknown>;
}

interface DeliveryRow {
    id: string;
    tenant_id: string;
    event_id: string;
    subscription_id: string;
    attempts: number;
    created_at: string;
    url: string;
    secret: string;
    payload: Envelope | null;
}

export interface DispatchDeps {
    fetch?: typeof fetch;
    now?: () => Date;
    /** Motivo por el que NO se debe enviar a esa URL, o null. Por defecto resuelve el DNS y exige IPs públicas. */
    checkHost?: (url: string) => Promise<string | null>;
}

export interface DispatchReport {
    events: number;
    coalesced: number;
    deliveries: { sent: number; delivered: number; retrying: number; failed: number };
    purged: number;
}

async function inChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
    for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

// ── 1. Eventos → sobres y entregas ──────────────────────────────────────────

/** Toma una tanda del outbox. Devuelve cuántos eventos procesó (0 = no había). */
export async function fanOut(db: SupabaseClient, report: DispatchReport): Promise<number> {
    const { data, error } = await db.rpc('webhooks_claim_events', { p_limit: CLAIM_EVENTS });
    if (error) throw error;
    const events = (data ?? []) as EventRow[];
    if (!events.length) return 0;

    const byTenant = new Map<string, EventRow[]>();
    for (const e of events) byTenant.set(e.tenant_id, [...(byTenant.get(e.tenant_id) ?? []), e]);

    for (const [tenantId, rows] of byTenant) {
        const targets = await activeWebhookTargets(db, tenantId);

        // Un recurso que cambió diez veces en el minuto genera UN aviso con su estado actual.
        const latest = new Map<string, EventRow>();
        for (const e of rows) {
            const k = `${e.type}|${e.resource_id}`;
            const prev = latest.get(k);
            if (!prev || prev.created_at < e.created_at) latest.set(k, e);
        }
        const kept = new Set([...latest.values()].map(e => e.id));
        const dropped = rows.filter(e => !kept.has(e.id)).map(e => e.id);
        if (dropped.length) {
            report.coalesced += dropped.length;
            await markProcessed(db, dropped, 'agrupado con un evento posterior del mismo recurso');
        }

        const listened = (e: EventRow) => targets.filter(t => t.events.includes(e.type));
        const toBuild = [...latest.values()].filter(e => listened(e).length > 0);
        const unlistened = [...latest.values()].filter(e => listened(e).length === 0).map(e => e.id);
        if (unlistened.length) await markProcessed(db, unlistened, 'sin suscripciones para este evento');

        const dtos = await loadResources(db, tenantId, toBuild);
        for (const e of toBuild) {
            const data = dtos.get(e.id);
            if (!data) {
                await markProcessed(db, [e.id], 'el recurso ya no está disponible');
                continue;
            }
            const envelope: Envelope = {
                id: e.id,
                type: e.type,
                created_at: new Date(e.created_at).toISOString(),
                organization_id: tenantId,
                data,
            };
            const { error: insErr } = await db.from('webhook_deliveries').upsert(
                listened(e).map(t => ({ tenant_id: tenantId, event_id: e.id, subscription_id: t.id })),
                { onConflict: 'event_id,subscription_id', ignoreDuplicates: true },
            );
            if (insErr) throw insErr;
            const { error: updErr } = await db.from('webhook_events')
                .update({ payload: envelope, processed_at: new Date().toISOString() }).eq('id', e.id);
            if (updErr) throw updErr;
        }
    }
    report.events += events.length;
    return events.length;
}

async function markProcessed(db: SupabaseClient, ids: string[], note: string) {
    const { error } = await db.from('webhook_events')
        .update({ processed_at: new Date().toISOString(), note }).in('id', ids);
    if (error) throw error;
}

/** `data` de cada evento: el mismo DTO de la API, leído ahora (con el stock del instante en `stock.bajo_minimo`). */
async function loadResources(db: SupabaseClient, tenantId: string, events: EventRow[]): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    const idsOf = (kind: ReturnType<typeof eventResource>) => [...new Set(events.filter(e => eventResource(e.type) === kind).map(e => e.resource_id))];

    const [materiales, activos, proveedores, stockMats] = await Promise.all([
        materialesByIds(db, tenantId, 'materiales', idsOf('material')),
        activosByIds(db, tenantId, idsOf('activo')),
        proveedoresByIds(db, tenantId, idsOf('proveedor')),
        materialesByIds(db, tenantId, 'materiales', idsOf('stock')),
    ]);
    const index = <T extends { id: string }>(list: T[]) => new Map(list.map(x => [x.id, x]));
    const mats = index(materiales), acts = index(activos), provs = index(proveedores), stock = index(stockMats);

    for (const e of events) {
        const kind = eventResource(e.type);
        if (kind === 'material') { const m = mats.get(e.resource_id); if (m) out.set(e.id, { ...m }); }
        else if (kind === 'activo') { const a = acts.get(e.resource_id); if (a) out.set(e.id, { ...a }); }
        else if (kind === 'proveedor') { const p = provs.get(e.resource_id); if (p) out.set(e.id, { ...p }); }
        else {
            const m = stock.get(e.resource_id);
            if (!m) continue;
            const ex = await getExistencias(db, tenantId, e.resource_id);
            out.set(e.id, {
                ...m,
                // Lo que había al cruzar el mínimo, no lo que haya cuando se despacha.
                stock_actual: e.detail?.stock_actual ?? m.stock_actual,
                stock_minimo: e.detail?.stock_minimo ?? m.stock_minimo,
                existencias: ex.existencias,
            });
        }
    }
    return out;
}

// ── 2. Entregas ─────────────────────────────────────────────────────────────

async function attempt(row: DeliveryRow, deps: Required<DispatchDeps>): Promise<{ ok: boolean; status: number | null; error: string | null }> {
    const blocked = await deps.checkHost(row.url);
    if (blocked) return { ok: false, status: null, error: blocked };
    const body = JSON.stringify(row.payload);
    try {
        const res = await deps.fetch(row.url, {
            method: 'POST',
            headers: { ...signedHeaders(row.secret, row.event_id, body, deps.now().getTime()), 'user-agent': 'Pagnol-Webhooks/1.0' },
            body,
            // Una redirección (p. ej. por una barra final que falta) NO se sigue: cuenta como fallo y queda dicho.
            redirect: 'manual',
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        await res.body?.cancel().catch(() => {});
        if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
        const where = res.status >= 300 && res.status < 400 ? ` (redirige a ${res.headers.get('location') ?? '?'})` : '';
        return { ok: false, status: res.status, error: `Respondió HTTP ${res.status}${where}.` };
    } catch (e) {
        const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        return { ok: false, status: null, error: timedOut ? `Sin respuesta en ${SEND_TIMEOUT_MS / 1000} s.` : String((e as Error)?.message ?? e).slice(0, 300) };
    }
}

/** Envía las entregas vencidas. Devuelve cuántas tomó (0 = no había). */
export async function deliverDue(db: SupabaseClient, deps: Required<DispatchDeps>, report: DispatchReport): Promise<number> {
    const { data, error } = await db.rpc('webhooks_claim_deliveries', { p_limit: CLAIM_DELIVERIES });
    if (error) throw error;
    const rows = (data ?? []) as DeliveryRow[];

    await inChunks(rows, SEND_CONCURRENCY, async row => {
        report.deliveries.sent++;
        if (!row.payload) {
            // No debería ocurrir (se crea junto con el sobre); si pasa, no se reintenta eternamente.
            await db.from('webhook_deliveries').update({ status: 'failed', last_error: 'Sin contenido que enviar.' }).eq('id', row.id);
            report.deliveries.failed++;
            return;
        }
        const res = await attempt(row, deps);
        const now = deps.now();
        const attempts = row.attempts + 1;
        let patch: Record<string, unknown>;
        if (res.ok) {
            patch = { status: 'delivered', attempts, last_status: res.status, last_error: null, delivered_at: now.toISOString() };
            report.deliveries.delivered++;
        } else {
            const plan = planRetry(attempts, new Date(row.created_at), now);
            patch = plan.status === 'failed'
                ? { status: 'failed', attempts, last_status: res.status, last_error: res.error }
                : { attempts, last_status: res.status, last_error: res.error, next_attempt_at: plan.nextAttemptAt.toISOString() };
            report.deliveries[plan.status === 'failed' ? 'failed' : 'retrying']++;
        }
        const { error: updErr } = await db.from('webhook_deliveries').update(patch).eq('id', row.id).eq('tenant_id', row.tenant_id);
        if (updErr) console.error('[webhooks] no se pudo registrar el resultado de', row.id, updErr.message);
    });
    return rows.length;
}

/** Un pulso completo: eventos → entregas, hasta vaciar lo pendiente o agotar el tiempo. */
export async function runDispatch(db: SupabaseClient, deps: DispatchDeps = {}, budgetMs = 45_000): Promise<DispatchReport> {
    const full: Required<DispatchDeps> = {
        fetch: deps.fetch ?? fetch,
        now: deps.now ?? (() => new Date()),
        checkHost: deps.checkHost ?? resolvedHostProblem,
    };
    const report: DispatchReport = { events: 0, coalesced: 0, deliveries: { sent: 0, delivered: 0, retrying: 0, failed: 0 }, purged: 0 };
    const deadline = Date.now() + budgetMs;

    while (Date.now() < deadline) {
        const fanned = await fanOut(db, report);
        const sent = await deliverDue(db, full, report);
        if (fanned === 0 && sent === 0) break;
    }

    const { data: purged } = await db.rpc('webhooks_purge');
    report.purged = typeof purged === 'number' ? purged : 0;
    return report;
}
