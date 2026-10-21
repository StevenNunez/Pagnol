import { authHeaders } from '@/modules/core/lib/auth-header';
import type { SignMethod } from '@/lib/daily-talk-attendance';

/** Llamadas a /api/safety/daily-talk. Todo error vuelve con mensaje legible. */

async function call(payload: Record<string, unknown>) {
    const res = await fetch('/api/safety/daily-talk', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || 'No se pudo completar la operación.');
    return json;
}

export interface SignOnTalkInput {
    talkId: string;
    method: SignMethod;
    /** Confirmó que comprendió los temas (distinto de haber asistido). */
    acknowledged?: boolean;
    /** Sólo en equipo compartido: a quién se le toma la firma. */
    workerId?: string;
    /** method 'face': descriptor del rostro frente a la cámara (el servidor lo compara). */
    descriptor?: number[];
    /** method 'handwritten': PNG en base64. */
    signature?: string;
}

export const signOnTalk = (input: SignOnTalkInput) => call({ action: 'sign', ...input });

export const markTalkAbsent = (talkId: string, workerId: string, note?: string) =>
    call({ action: 'absent', talkId, workerId, note });

/** `all` al registrar la charla; `pending` para insistirle sólo a quien falta. */
export const notifyTalk = (talkId: string, scope: 'all' | 'pending'): Promise<{ targeted: number; sent: number }> =>
    call({ action: 'notify', talkId, scope });
