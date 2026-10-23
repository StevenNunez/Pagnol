import 'server-only';
import { NextResponse } from 'next/server';
import { requireAuth, hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';

/**
 * Piezas comunes de las rutas /api/pin/*. Todas escriben con service role (la
 * tabla `worker_pins` no tiene acceso para el navegador), así que cada una
 * repite las mismas tres comprobaciones ANTES de tocar nada: quién llama, de qué
 * empresa es la persona, y si el llamante tiene derecho a operar sobre ella.
 */

export interface PinWorker {
    id: string;
    name: string;
    tenant_id: string | null;
    employment_status: string | null;
}

/** El PIN lo opera quien atiende el pañol, el propio trabajador, o quien gestiona usuarios/RR.HH. */
export function canUsePin(ctx: AuthContext, workerId: string): boolean {
    return ctx.userId === workerId
        || hasPermission(ctx, 'module_pagnol:view')
        || hasPermission(ctx, 'users:edit')
        || hasPermission(ctx, 'hr_employees:edit');
}

/** Restablecer un PIN (borrarlo) es de RR.HH./usuarios: no de quien atiende el mesón. */
export function canResetPin(ctx: AuthContext): boolean {
    return hasPermission(ctx, 'users:edit') || hasPermission(ctx, 'hr_employees:edit');
}

export function fail(error: string, status: number, extra: Record<string, unknown> = {}) {
    return NextResponse.json({ error, ...extra }, { status });
}

/** Sesión + la persona del PIN, acotada a la empresa de quien llama. */
export async function authAndWorker(
    request: Request,
    workerId: unknown,
    check: (ctx: AuthContext, workerId: string) => boolean,
): Promise<{ ok: true; ctx: AuthContext; worker: PinWorker } | { ok: false; response: NextResponse }> {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth;
    const { ctx } = auth;

    if (typeof workerId !== 'string' || !workerId) return { ok: false, response: fail('Falta el trabajador.', 400) };
    if (!check(ctx, workerId)) return { ok: false, response: fail('No autorizado.', 403) };

    const { data } = await ctx.admin
        .from('profiles')
        .select('id, name, tenant_id, employment_status')
        .eq('id', workerId)
        .is('deleted_at', null)
        .maybeSingle();
    if (!data || (!ctx.isSuperAdmin && data.tenant_id !== ctx.tenantId)) {
        return { ok: false, response: fail('No se encontró al trabajador.', 404) };
    }
    return { ok: true, ctx, worker: data as PinWorker };
}
