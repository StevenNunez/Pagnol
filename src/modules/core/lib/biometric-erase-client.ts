import { authHeaders } from '@/modules/core/lib/auth-header';

/** Llamada a /api/biometric/erase. Todo error vuelve con mensaje legible. */

export type EraseReason = 'revocation' | 'separation';

export async function eraseBiometricData(
    workerId: string,
    reason: EraseReason,
): Promise<{ template: boolean; documents: boolean; sessions: boolean }> {
    const res = await fetch('/api/biometric/erase', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ workerId, reason }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || 'No se pudo borrar los datos biométricos.');
    return json.erased;
}
