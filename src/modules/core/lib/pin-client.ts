import { authHeaders } from '@/modules/core/lib/auth-header';

/** Llamadas a /api/pin/*. Los errores llevan `code` para que la pantalla decida qué mostrar. */

export class PinError extends Error {
    code: string;
    attemptsLeft?: number;
    minutesLeft?: number;
    constructor(message: string, code: string, extra: { attemptsLeft?: number; minutesLeft?: number } = {}) {
        super(message);
        this.code = code;
        this.attemptsLeft = extra.attemptsLeft;
        this.minutesLeft = extra.minutesLeft;
    }
}

async function parse(res: Response) {
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
        throw new PinError(json.error || 'No se pudo completar la operación.', json.code || 'error', {
            attemptsLeft: json.attemptsLeft, minutesLeft: json.minutesLeft,
        });
    }
    return json;
}

export interface PinStatus {
    /** La empresa exige PIN en la entrega por carnet. */
    required: boolean;
    hasPin: boolean;
    setAt: string | null;
    locked: boolean;
    minutesLeft: number;
    attemptsLeft: number;
}

export async function getPinStatus(workerId: string): Promise<PinStatus> {
    const res = await fetch(`/api/pin/status?workerId=${encodeURIComponent(workerId)}`, { headers: await authHeaders() });
    return parse(res);
}

export async function createPin(workerId: string, pin: string): Promise<void> {
    const res = await fetch('/api/pin/set', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ workerId, pin }) });
    await parse(res);
}

export async function verifyPin(
    workerId: string, pin: string, trace: { requestId?: string | null; transactionCode?: string | null } = {},
): Promise<{ verificationId: string }> {
    const res = await fetch('/api/pin/verify', {
        method: 'POST', headers: await authHeaders(),
        body: JSON.stringify({ workerId, pin, requestId: trace.requestId ?? null, transactionCode: trace.transactionCode ?? null }),
    });
    return parse(res);
}

export async function resetPin(workerId: string): Promise<void> {
    const res = await fetch('/api/pin/reset', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ workerId }) });
    await parse(res);
}
