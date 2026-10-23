import { NextResponse } from 'next/server';
import { authAndWorker, canResetPin, fail } from '@/lib/pin-route';

/**
 * Restablecer el PIN de una persona (lo olvidó, o se sospecha que otro lo supo).
 * Lo BORRA: nadie fija el PIN de otro. El trabajador crea uno nuevo, él mismo,
 * en su próxima entrega por carnet. Sólo RR.HH. o quien gestiona usuarios.
 */
export async function POST(request: Request) {
    try {
        const { workerId } = await request.json().catch(() => ({}));
        const r = await authAndWorker(request, workerId, (ctx) => canResetPin(ctx));
        if (!r.ok) return r.response;
        const { ctx, worker } = r;

        const { error } = await ctx.admin.from('worker_pins').delete().eq('user_id', worker.id);
        if (error) {
            console.error('[pin/reset]', error.message);
            return fail('No se pudo restablecer el PIN.', 500);
        }
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[pin/reset]', err?.message || err);
        return fail('Error interno del servidor.', 500);
    }
}
