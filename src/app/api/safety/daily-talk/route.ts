import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requireAuth, hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';
import { verifyAgainst, MATCH_THRESHOLD, DESCRIPTOR_LENGTH } from '@/modules/data/mutations/matchMath';
import { sendPushToUsers } from '@/lib/push-notify';
import { pendingWorkerIds, type SignatureFact } from '@/lib/daily-talk-attendance';

/**
 * Firma de asistencia a las charlas diarias.
 *
 *   POST {action:'sign',   talkId, method, acknowledged, …}
 *   POST {action:'absent', talkId, workerId, note?}
 *   POST {action:'notify', talkId, scope:'all'|'pending'}
 *
 * Todo hecho se escribe AQUÍ, con la service role, y no desde el navegador: la
 * ruta es la que decide si quien firma es quien dice ser.
 *   · own_session → el propio trabajador, con su sesión (nadie firma por otro);
 *   · face        → el responsable de la charla en un equipo compartido; el
 *                   rostro se compara EN EL SERVIDOR contra la bóveda (el
 *                   navegador sólo manda el descriptor de quien está frente a la
 *                   cámara; nunca "verified: true");
 *   · handwritten → el responsable toma la firma manuscrita del trabajador, para
 *                   quien no tiene cuenta ni rostro enrolado. Queda anotado quién
 *                   la tomó.
 * Las firmas viven en `daily_talk_signatures` (append-only).
 */

const MAX_SIGNATURE_CHARS = 400_000; // ~300 KB de PNG en base64
const NOTIFY_COOLDOWN_MS = 5 * 60_000;
const lastNotified = new Map<string, number>();

const MAX_FACE_PER_MINUTE = 60;
const faceHistory = new Map<string, number[]>();
function faceLimitExceeded(userId: string): boolean {
    const now = Date.now();
    const prev = (faceHistory.get(userId) ?? []).filter(t => now - t < 60_000);
    prev.push(now);
    faceHistory.set(userId, prev);
    return prev.length > MAX_FACE_PER_MINUTE;
}

interface TalkRow {
    id: string;
    tenant_id: string;
    obra: string | null;
    fecha: string | null;
    temas: string | null;
    expositor_id: string | null;
    expositor_name: string | null;
    asistentes: { id: string; name: string; rut?: string }[] | null;
}

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

function isManager(ctx: AuthContext, talk: TalkRow) {
    return ctx.isSuperAdmin || talk.expositor_id === ctx.userId || hasPermission(ctx, 'safety_talks:manage');
}

const contentHash = (t: TalkRow) =>
    createHash('sha256').update(`${t.id}|${t.obra ?? ''}|${t.fecha ?? ''}|${t.temas ?? ''}`).digest('hex');

function readDescriptor(v: unknown): number[] | null {
    if (!Array.isArray(v) || v.length !== DESCRIPTOR_LENGTH) return null;
    return v.every(n => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : null;
}

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        let body: any;
        try { body = await request.json(); } catch { return fail('Cuerpo inválido.'); }
        const { action, talkId } = body ?? {};
        if (!talkId || !['sign', 'absent', 'notify'].includes(action)) return fail('Datos incompletos.');

        const a = ctx.admin;
        const { data: talk } = await a
            .from('daily_talks')
            .select('id, tenant_id, obra, fecha, temas, expositor_id, expositor_name, asistentes')
            .eq('id', talkId).single<TalkRow>();
        if (!talk || (!ctx.isSuperAdmin && talk.tenant_id !== ctx.tenantId)) return fail('La charla no existe.', 404);

        const convened = new Map((talk.asistentes ?? []).map(x => [x.id, x]));
        const manager = isManager(ctx, talk);

        // ── Avisar ────────────────────────────────────────────────────────────
        if (action === 'notify') {
            if (!manager) return fail('Solo quien lleva la charla puede avisar a los asistentes.', 403);
            const key = `${talk.id}:${body.scope}`;
            const last = lastNotified.get(key) ?? 0;
            if (body.scope === 'pending' && Date.now() - last < NOTIFY_COOLDOWN_MS) {
                return fail('Ya avisaste hace un momento. Espera unos minutos antes de insistir.', 429);
            }
            let ids = [...convened.keys()];
            if (body.scope !== 'all') {
                const { data: facts } = await a.from('daily_talk_signatures')
                    .select('talk_id, worker_id, status').eq('talk_id', talk.id);
                const asFacts: SignatureFact[] = (facts ?? []).map(f => ({ talkId: f.talk_id, workerId: f.worker_id, status: f.status }));
                ids = pendingWorkerIds({ id: talk.id, asistentes: talk.asistentes ?? [] }, asFacts);
            }
            ids = ids.filter(id => id !== ctx.userId);
            if (ids.length === 0) return NextResponse.json({ success: true, targeted: 0, sent: 0 });
            lastNotified.set(key, Date.now());
            const r = await sendPushToUsers(talk.tenant_id, ids, {
                title: body.scope === 'all' ? 'Charla de seguridad: firma tu asistencia' : 'Te falta firmar la charla de seguridad',
                body: `${talk.expositor_name ?? 'Tu supervisor'} registró una charla (${talk.obra ?? ''}). Entra y confirma tu asistencia.`,
                url: `/dashboard/worker/sign-talk/${talk.id}`,
                tag: `daily-talk-${talk.id}`,
            });
            // `sent` cuenta suscripciones, no personas: quien no tiene la app instalada
            // no recibe nada, y para ellos existe la firma en el equipo del responsable.
            return NextResponse.json({ success: true, targeted: ids.length, sent: r.sent });
        }

        // ── Ausente ───────────────────────────────────────────────────────────
        if (action === 'absent') {
            if (!manager) return fail('Solo quien lleva la charla puede marcar ausentes.', 403);
            const w = convened.get(body.workerId);
            if (!w) return fail('Esa persona no está convocada a la charla.');
            const { error } = await a.from('daily_talk_signatures').insert({
                tenant_id: talk.tenant_id, talk_id: talk.id, worker_id: w.id, worker_name: w.name, worker_rut: w.rut || null,
                status: 'absent', method: null, recorded_by: ctx.userId,
                recorded_by_name: (await a.from('profiles').select('name').eq('id', ctx.userId).single()).data?.name ?? 'Responsable',
                note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 300) : null,
                content_hash: contentHash(talk),
            });
            if (error?.code === '23505') return fail('Ya estaba marcado como ausente.');
            if (error) throw error;
            return NextResponse.json({ success: true });
        }

        // ── Firmar ────────────────────────────────────────────────────────────
        const method = body.method as 'own_session' | 'face' | 'handwritten';
        if (!['own_session', 'face', 'handwritten'].includes(method)) return fail('Método de firma inválido.');

        const workerId: string = method === 'own_session' ? ctx.userId : body.workerId;
        if (!workerId) return fail('Falta indicar quién firma.');
        if (method === 'own_session' && body.workerId && body.workerId !== ctx.userId) {
            return fail('Solo puedes firmar por ti mismo desde tu sesión.', 403);
        }
        if (method !== 'own_session' && !manager) {
            return fail('Solo quien lleva la charla puede tomar firmas en su equipo.', 403);
        }
        const w = convened.get(workerId);
        if (!w) return fail(method === 'own_session' ? 'No estás en la lista de asistentes de esta charla.' : 'Esa persona no está convocada a la charla.');

        const { data: profile } = await a.from('profiles')
            .select('name, rut, tenant_id, signature, employment_status, is_active, deleted_at')
            .eq('id', workerId).single();
        if (!profile || profile.tenant_id !== talk.tenant_id || profile.deleted_at || profile.is_active === false
            || profile.employment_status === 'terminated') {
            return fail('Esa persona ya no está activa en la empresa.');
        }

        const evidence: Record<string, unknown> = {
            userAgent: (request.headers.get('user-agent') ?? '').slice(0, 300),
            ip: (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null,
        };
        let signature: string | null = null;

        if (method === 'own_session') {
            signature = profile.signature || null;
        } else if (method === 'face') {
            if (faceLimitExceeded(ctx.userId)) return fail('Demasiados intentos seguidos. Espera un momento.', 429);
            const live = readDescriptor(body.descriptor);
            if (!live) return fail(`El descriptor debe ser un arreglo de ${DESCRIPTOR_LENGTH} números.`);
            const { data: vault } = await a.from('biometric_templates')
                .select('template').eq('user_id', workerId).eq('tenant_id', talk.tenant_id).maybeSingle();
            const r = verifyAgainst(live, vault?.template ?? null, MATCH_THRESHOLD);
            if (r.reason === 'empty') return fail('Esta persona no tiene el rostro enrolado. Usa la firma manuscrita.');
            if (!r.matched) return fail('No coincide la persona. Intenta de nuevo o usa la firma manuscrita.', 422);
            evidence.faceDistance = r.distance === null ? null : Math.round(r.distance * 1000) / 1000;
            evidence.faceThreshold = r.threshold;
        } else {
            const ink = typeof body.signature === 'string' ? body.signature : '';
            if (!ink.startsWith('data:image/png;base64,') || ink.length > MAX_SIGNATURE_CHARS) {
                return fail('La firma manuscrita es obligatoria.');
            }
            signature = ink;
        }

        const recorder = await a.from('profiles').select('name').eq('id', ctx.userId).single();
        const { error } = await a.from('daily_talk_signatures').insert({
            tenant_id: talk.tenant_id, talk_id: talk.id, worker_id: workerId, worker_name: profile.name || w.name,
            worker_rut: profile.rut || w.rut || null, status: 'signed', method,
            acknowledged: body.acknowledged === true, signature, recorded_by: ctx.userId,
            recorded_by_name: recorder.data?.name ?? 'Responsable', evidence, content_hash: contentHash(talk),
        });
        if (error?.code === '23505') return fail('Esta persona ya firmó la charla.');
        if (error) throw error;
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[safety/daily-talk]', err?.message || err);
        return fail('Error interno del servidor.', 500);
    }
}
