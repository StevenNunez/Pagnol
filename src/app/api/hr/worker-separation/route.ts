import { managerIdsFromRow } from '@/lib/warehouse-managers';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';
import { mappers } from '@/modules/data/mappers';
import { sendPushToUsers } from '@/lib/push-notify';
import {
    pendingEquipmentOf, separationNotifyIds, SEPARATION_REASON_LABEL,
    type SeparationReason, type PendingItem,
} from '@/lib/worker-separation';
import type { Material, MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';

/**
 * Desvincular / reincorporar a un trabajador (por contrato o de la empresa).
 *
 *   GET  ?workerId=…  → qué equipos tiene sin devolver (para mostrarlo ANTES de confirmar)
 *   POST {action:'separate'|'reinstate', …}
 *
 * La escritura la hacen las funciones `separate_worker` / `reinstate_worker`, que
 * se llaman con el TOKEN DE QUIEN ACTÚA (no con la service role): así la base ve
 * su `auth.uid()` y decide por sí misma si puede, además de este permiso. La
 * service role se usa sólo para LEER el panorama (retiros, devoluciones, equipo
 * a avisar), siempre acotado a la empresa del trabajador.
 */

// Mismo criterio que la ficha RR.HH.: gestor de RR.HH. o de usuarios. La base vuelve a
// decidirlo con `can_manage_hr()` al escribir.
const canManage = (ctx: AuthContext) => hasPermission(ctx, 'hr_employees:edit') || hasPermission(ctx, 'users:edit');

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await build(from, from + 999);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
    }
    return rows;
}

async function loadWorker(ctx: AuthContext, workerId: string) {
    const { data } = await ctx.admin
        .from('profiles')
        .select('id, name, tenant_id, role, responsible_supervisor_id, employment_status')
        .eq('id', workerId).is('deleted_at', null).single();
    if (!data) return null;
    if (!ctx.isSuperAdmin && data.tenant_id !== ctx.tenantId) return null;
    return data;
}

async function pendingFor(ctx: AuthContext, tenantId: string, workerId: string): Promise<PendingItem[]> {
    const a = ctx.admin;
    const [mats, reqs, rets] = await Promise.all([
        fetchAll((f, t) => a.from('materials').select('*').eq('tenant_id', tenantId).range(f, t)),
        fetchAll((f, t) => a.from('material_requests').select('*').eq('tenant_id', tenantId).eq('status', 'approved').range(f, t)),
        fetchAll((f, t) => a.from('return_requests').select('*').eq('tenant_id', tenantId).eq('status', 'completed').range(f, t)),
    ]);
    return pendingEquipmentOf(
        workerId,
        mats.map(m => mappers.materials(m) as Material),
        reqs.map(r => mappers.material_requests(r) as MaterialRequest),
        rets.map(r => mappers.return_requests(r) as ReturnRequest),
    );
}

export async function GET(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        if (!canManage(auth.ctx)) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
        const workerId = new URL(request.url).searchParams.get('workerId');
        if (!workerId) return NextResponse.json({ error: 'Falta el trabajador.' }, { status: 400 });

        const worker = await loadWorker(auth.ctx, workerId);
        if (!worker) return NextResponse.json({ error: 'No se encontró al trabajador.' }, { status: 404 });

        return NextResponse.json({ pending: await pendingFor(auth.ctx, worker.tenant_id, workerId) });
    } catch (err: any) {
        console.error('[hr/worker-separation GET]', err?.message || err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        if (!canManage(auth.ctx)) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
        const { ctx } = auth;

        const body = await request.json();
        const { action, workerId, scope, contractId, effectiveDate, reason } = body;
        if (!workerId || (action !== 'separate' && action !== 'reinstate')) {
            return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
        }

        const worker = await loadWorker(ctx, workerId);
        if (!worker) return NextResponse.json({ error: 'No se encontró al trabajador.' }, { status: 404 });

        // Cliente con la sesión de quien actúa: la base ve su identidad.
        const token = request.headers.get('authorization')!.replace('Bearer ', '').trim();
        const asUser = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
        );

        if (action === 'reinstate') {
            const { data, error } = await asUser.rpc('reinstate_worker', {
                p_worker: workerId, p_scope: scope, p_contract: contractId ?? null,
                p_effective: effectiveDate, p_reason: reason ?? '',
            });
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            return NextResponse.json({ success: true, id: data });
        }

        if (!(scope in { company: 1, contract: 1 })) {
            return NextResponse.json({ error: 'Indica si es del contrato o de la empresa.' }, { status: 400 });
        }
        const reasonKind = body.reasonKind as SeparationReason;
        if (!(reasonKind in SEPARATION_REASON_LABEL)) {
            return NextResponse.json({ error: 'Elige el motivo.' }, { status: 400 });
        }

        // Lo que tenía en su poder, ANTES de cortar nada: queda escrito en el hecho.
        const pending = await pendingFor(ctx, worker.tenant_id, workerId);

        const { data: id, error } = await asUser.rpc('separate_worker', {
            p_worker: workerId, p_scope: scope, p_contract: contractId ?? null,
            p_effective: effectiveDate, p_reason_kind: reasonKind, p_reason: reason ?? '',
            p_pending: pending,
        });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });

        // ── Avisos: sólo si queda algo por devolver ──────────────────────────
        let notified = 0;
        if (pending.length > 0) {
            try {
                const a = ctx.admin;
                const [users, cws, whs] = await Promise.all([
                    a.from('profiles').select('id, role, employment_status, is_active, responsible_supervisor_id').eq('tenant_id', worker.tenant_id).is('deleted_at', null),
                    a.from('contract_workers').select('contract_id, user_id, end_date').eq('tenant_id', worker.tenant_id),
                    a.from('warehouses').select('manager_ids').eq('tenant_id', worker.tenant_id),
                ]);
                const ids = separationNotifyIds(workerId, ctx.userId, scope === 'contract' ? contractId : null, {
                    users: (users.data ?? []).map(u => ({
                        id: u.id, role: u.role, employmentStatus: u.employment_status, isActive: u.is_active,
                        responsibleSupervisorId: u.responsible_supervisor_id,
                    })),
                    contractWorkers: (cws.data ?? []).filter(c => !c.end_date).map(c => ({ contractId: c.contract_id, userId: c.user_id })),
                    warehouses: (whs.data ?? []).map(w => ({ managerIds: managerIdsFromRow(w) })),
                });
                if (ids.length > 0) {
                    const names = pending.slice(0, 3).map(p => p.name).join(', ');
                    await sendPushToUsers(worker.tenant_id, ids, {
                        title: 'Desvinculación con equipos pendientes',
                        body: `${worker.name} se desvinculó y tiene ${pending.length} equipo${pending.length !== 1 ? 's' : ''} sin devolver: ${names}${pending.length > 3 ? '…' : ''}.`,
                        url: '/dashboard/rrhh/desvinculaciones',
                        tag: `separation-${id}`,
                    });
                    notified = ids.length;
                }
            } catch (e: any) {
                // La desvinculación ya quedó hecha; un aviso que falla no la deshace.
                console.error('[hr/worker-separation] aviso', e?.message || e);
            }
        }

        return NextResponse.json({ success: true, id, pending, notified });
    } catch (err: any) {
        console.error('[hr/worker-separation POST]', err?.message || err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
