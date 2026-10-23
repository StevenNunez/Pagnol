import { NextResponse } from 'next/server';
import { authAndWorker, canUsePin, fail } from '@/lib/pin-route';
import { pinLockState, PIN_MAX_ATTEMPTS } from '@/lib/pin';
import { pinMatches } from '@/lib/pin-server';

/**
 * Comprobar el PIN al aceptar una entrega identificada con carnet.
 *
 * Esta ruta ESCRIBE la evidencia (`id_document_pin`) en el momento exacto en que
 * el PIN resulta correcto, en vez de dejar que el navegador la registre después:
 * así el hecho no depende de que la pantalla se acuerde de anotarlo, y no se
 * puede anotar un acierto que no ocurrió.
 *
 * Códigos de respuesta (el `code` es lo que lee la pantalla):
 *   200 {ok:true, verificationId}     → PIN correcto, evidencia escrita
 *   404 no_pin                         → todavía no tiene PIN (hay que crearlo)
 *   423 locked {minutesLeft}           → bloqueado por demasiados fallos
 *   401 wrong {attemptsLeft | locked}  → PIN incorrecto
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const r = await authAndWorker(request, body.workerId, canUsePin);
        if (!r.ok) return r.response;
        const { ctx, worker } = r;

        const { data: row } = await ctx.admin
            .from('worker_pins')
            .select('pin_hash, pin_salt, failed_attempts, locked_until')
            .eq('user_id', worker.id)
            .maybeSingle();
        if (!row) return fail('Esta persona todavía no tiene PIN.', 404, { code: 'no_pin' });

        const lock = pinLockState({ failedAttempts: row.failed_attempts, lockedUntil: row.locked_until });
        if (lock.locked) {
            return fail(`PIN bloqueado por demasiados intentos. Reintenta en ${lock.minutesLeft} min.`, 423, {
                code: 'locked', minutesLeft: lock.minutesLeft,
            });
        }

        const ok = typeof body.pin === 'string' && pinMatches(body.pin, row.pin_salt, row.pin_hash);
        if (!ok) {
            const { data: after } = await ctx.admin.rpc('pin_register_failure', { p_user: worker.id });
            const f = Array.isArray(after) ? after[0] : after;
            if (f?.locked_until) {
                const l = pinLockState({ failedAttempts: f.failed_attempts, lockedUntil: f.locked_until });
                return fail(`PIN incorrecto. Quedó bloqueado por ${l.minutesLeft} min.`, 423, {
                    code: 'locked', minutesLeft: l.minutesLeft,
                });
            }
            const attemptsLeft = Math.max(0, PIN_MAX_ATTEMPTS - (f?.failed_attempts ?? 0));
            return fail(`PIN incorrecto. Te quedan ${attemptsLeft} intento${attemptsLeft === 1 ? '' : 's'}.`, 401, {
                code: 'wrong', attemptsLeft,
            });
        }

        await ctx.admin.rpc('pin_register_success', { p_user: worker.id });

        // La evidencia: quién fue identificado, quién operaba, en qué trámite.
        const { data: operator } = await ctx.admin.from('profiles').select('name').eq('id', ctx.userId).maybeSingle();
        const { data: ev, error } = await ctx.admin
            .from('biometric_verifications')
            .insert({
                tenant_id: worker.tenant_id,
                subject_user_id: worker.id,
                subject_name: worker.name,
                operator_user_id: ctx.userId,
                operator_name: operator?.name ?? null,
                stage: 'recepcion',
                request_id: typeof body.requestId === 'string' ? body.requestId : null,
                transaction_code: typeof body.transactionCode === 'string' ? body.transactionCode : null,
                outcome: 'id_document_pin',
            })
            .select('id')
            .single();
        if (error) {
            // Sin evidencia no hay acuse: mejor repetir el PIN que entregar sin respaldo.
            console.error('[pin/verify] evidencia:', error.message);
            return fail('El PIN es correcto pero no se pudo dejar el respaldo. Intenta de nuevo.', 500, { code: 'evidence' });
        }
        return NextResponse.json({ ok: true, verificationId: ev.id });
    } catch (err: any) {
        console.error('[pin/verify]', err?.message || err);
        return fail('Error interno del servidor.', 500);
    }
}
