import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { sendPushToUsers } from '@/lib/push-notify';
import {
    summarizeReview, indexReviews, reviewerIdsFor, resolveObservations,
    type ReviewFact,
} from '@/modules/data/mutations/withdrawalReviewMath';

// Cron diario (ver vercel.json), al final de la jornada. Para cada empresa en
// modo "revisión posterior":
//   · a quien le toca revisar → cuántos retiros del pañol tiene pendientes;
//   · a administración → cuánto de lo "no autorizado" sigue abierto (ni
//     devuelto ni justificado) desde hace más de un día.
// Las mismas funciones puras que usa la pantalla deciden quién revisa y qué
// está abierto, así el aviso y la bandeja no pueden contar distinto.

const WINDOW_DAYS = 60;
const OBSERVATION_GRACE_HOURS = 24;

export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('CRON_SECRET no configurado — cron deshabilitado por seguridad.');
        return NextResponse.json({ error: 'Cron no configurado (falta CRON_SECRET).' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();
    try {
        const { data: tenants, error: tErr } = await admin
            .from('tenants').select('id').eq('withdrawal_review_mode', 'post');
        if (tErr) throw tErr;

        const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
        const graceLimit = Date.now() - OBSERVATION_GRACE_HOURS * 3_600_000;
        const report: Record<string, { reviewersNotified: number; pending: number; openObservations: number }> = {};

        for (const { id: tenantId } of tenants || []) {
            const [reqs, reviews, resolutions, returns, profiles, cws] = await Promise.all([
                admin.from('material_requests').select('id, supervisor_id, contract_id, items, created_at')
                    .eq('tenant_id', tenantId).eq('requires_review', true).gte('created_at', since),
                admin.from('withdrawal_reviews').select('id, request_id, material_id, decision, quantity')
                    .eq('tenant_id', tenantId).gte('created_at', since),
                admin.from('withdrawal_review_resolutions').select('review_id').eq('tenant_id', tenantId),
                admin.from('return_requests').select('id, internal_code, supervisor_id, material_id, quantity, status, completion_date, created_at')
                    .eq('tenant_id', tenantId).gte('created_at', since),
                admin.from('profiles').select('id, role, is_active, deleted_at').eq('tenant_id', tenantId),
                admin.from('contract_workers').select('contract_id, user_id').eq('tenant_id', tenantId),
            ]);
            for (const r of [reqs, reviews, resolutions, returns, profiles, cws]) if (r.error) throw r.error;

            const users = (profiles.data || [])
                .filter(p => p.is_active !== false && !p.deleted_at)
                .map(p => ({ id: p.id as string, role: p.role as string }));
            const contractWorkers = (cws.data || []).map(c => ({ contractId: c.contract_id as string, userId: c.user_id as string }));
            const facts: (ReviewFact & { id: string; quantity: number })[] = (reviews.data || []).map(r => ({
                id: r.id, requestId: r.request_id, materialId: r.material_id, decision: r.decision, quantity: Number(r.quantity) || 0,
            }));
            const byRequest = indexReviews(facts);

            // ── Pendientes de revisar, por revisor ────────────────────────────
            const pendingByReviewer = new Map<string, number>();
            let pendingTotal = 0;
            for (const r of reqs.data || []) {
                const items = Array.isArray(r.items) ? r.items : [];
                const summary = summarizeReview(
                    { id: r.id, requiresReview: true, contractId: r.contract_id, supervisorId: r.supervisor_id, items },
                    byRequest.get(r.id) || [],
                );
                if (summary.state === 'reviewed') continue;
                pendingTotal++;
                for (const uid of reviewerIdsFor(r.contract_id, r.supervisor_id, users, contractWorkers)) {
                    pendingByReviewer.set(uid, (pendingByReviewer.get(uid) || 0) + 1);
                }
            }
            for (const [uid, n] of pendingByReviewer) {
                await sendPushToUsers(tenantId, [uid], {
                    title: 'Retiros por revisar',
                    body: `Tienes ${n} retiro${n !== 1 ? 's' : ''} del pañol esperando tu revisión.`,
                    url: '/dashboard/supervisor/revisar-retiros',
                    tag: 'withdrawal-review-reminder',
                });
            }

            // ── Lo no autorizado que sigue abierto ────────────────────────────
            const reqById = new Map((reqs.data || []).map(r => [r.id, r]));
            const flagged = facts.filter(f => f.decision === 'unauthorized' && reqById.has(f.requestId));
            const states = resolveObservations(
                flagged.map(f => {
                    const r = reqById.get(f.requestId)!;
                    return {
                        reviewId: f.id, requestId: f.requestId, workerId: r.supervisor_id, materialId: f.materialId,
                        quantity: f.quantity, withdrawnAt: new Date(r.created_at),
                    };
                }),
                (returns.data || []).map(r => ({
                    id: r.id, internalCode: r.internal_code, workerId: r.supervisor_id, materialId: r.material_id,
                    quantity: Number(r.quantity) || 0, status: r.status, at: new Date(r.completion_date || r.created_at),
                })),
                new Set((resolutions.data || []).map(r => r.review_id as string)),
            );
            const openObservations = flagged.filter(f =>
                states.get(f.id)?.status === 'open'
                && new Date(reqById.get(f.requestId)!.created_at).getTime() < graceLimit
            ).length;
            const adminIds = users.filter(u => u.role === 'administrador').map(u => u.id);
            if (openObservations > 0 && adminIds.length > 0) {
                await sendPushToUsers(tenantId, adminIds, {
                    title: 'No autorizados sin cerrar',
                    body: `${openObservations} ítem${openObservations !== 1 ? 's' : ''} marcado${openObservations !== 1 ? 's' : ''} como no autorizado${openObservations !== 1 ? 's' : ''} sigue${openObservations !== 1 ? 'n' : ''} sin devolverse ni justificarse.`,
                    url: '/dashboard/pagnol/revisar-retiros',
                    tag: 'withdrawal-observations-reminder',
                });
            }

            report[tenantId] = { reviewersNotified: pendingByReviewer.size, pending: pendingTotal, openObservations };
        }

        return NextResponse.json({ ok: true, tenants: report });
    } catch (err: any) {
        console.error('[cron withdrawal-reviews]', err?.message || err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
