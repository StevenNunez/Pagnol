import { NextResponse } from 'next/server';
import { authAndWorker, canUsePin, fail } from '@/lib/pin-route';
import { pinLockState } from '@/lib/pin';

/**
 * ¿Esta persona ya tiene PIN, y está bloqueada? Nunca devuelve nada del PIN.
 * También dice si su empresa lo exige, para que la pantalla no tenga que pedirlo
 * por otro lado.
 */
export async function GET(request: Request) {
    try {
        const workerId = new URL(request.url).searchParams.get('workerId');
        const r = await authAndWorker(request, workerId, canUsePin);
        if (!r.ok) return r.response;
        const { ctx, worker } = r;

        const [{ data: pin }, { data: tenant }] = await Promise.all([
            ctx.admin.from('worker_pins')
                .select('set_at, failed_attempts, locked_until').eq('user_id', worker.id).maybeSingle(),
            worker.tenant_id
                ? ctx.admin.from('tenants').select('carnet_pin_required').eq('id', worker.tenant_id).maybeSingle()
                : Promise.resolve({ data: null }),
        ]);

        const lock = pinLockState(pin ? { failedAttempts: pin.failed_attempts, lockedUntil: pin.locked_until } : null);
        return NextResponse.json({
            required: tenant?.carnet_pin_required === true,
            hasPin: !!pin,
            setAt: pin?.set_at ?? null,
            locked: lock.locked,
            minutesLeft: lock.minutesLeft,
            attemptsLeft: lock.attemptsLeft,
        });
    } catch (err: any) {
        console.error('[pin/status]', err?.message || err);
        return fail('Error interno del servidor.', 500);
    }
}
