import { NextResponse } from 'next/server';
import { authAndWorker, canUsePin, fail } from '@/lib/pin-route';
import { pinFormatError, PIN_FORMAT_MESSAGE } from '@/lib/pin';
import { hashPin, newSalt } from '@/lib/pin-server';

/**
 * Crear el PIN de una persona. SÓLO si todavía no tiene: quien atiende el mesón
 * no puede pisar el PIN de alguien (eso sería poder aceptar entregas a su
 * nombre). Cambiarlo pasa por «Restablecer» (RR.HH.), que lo borra, y el
 * trabajador crea uno nuevo en su siguiente entrega.
 *
 * El PIN lo digita el trabajador en el equipo del pañol; esta ruta no puede
 * comprobarlo, así que deja escrito quién estaba en el equipo (`set_by`).
 */
export async function POST(request: Request) {
    try {
        const { workerId, pin } = await request.json().catch(() => ({}));
        const r = await authAndWorker(request, workerId, canUsePin);
        if (!r.ok) return r.response;
        const { ctx, worker } = r;

        const bad = pinFormatError(String(pin ?? ''));
        if (bad) return fail(PIN_FORMAT_MESSAGE[bad], 400, { code: bad });

        const salt = newSalt();
        const { error } = await ctx.admin.from('worker_pins').insert({
            user_id: worker.id,
            tenant_id: worker.tenant_id,
            pin_hash: hashPin(String(pin), salt),
            pin_salt: salt,
            set_by: ctx.userId,
        });
        if (error) {
            // Clave primaria repetida = ya tenía PIN.
            if ((error as any).code === '23505') {
                return fail('Esta persona ya tiene PIN. Si lo olvidó, pide a RR.HH. que lo restablezca.', 409, { code: 'exists' });
            }
            console.error('[pin/set]', error.message);
            return fail('No se pudo guardar el PIN.', 500);
        }
        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[pin/set]', err?.message || err);
        return fail('Error interno del servidor.', 500);
    }
}
