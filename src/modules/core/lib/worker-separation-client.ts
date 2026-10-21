import { authHeaders } from '@/modules/core/lib/auth-header';
import type { PendingItem, SeparationReason, SeparationScope } from '@/lib/worker-separation';

/** Llamadas a /api/hr/worker-separation. Todo error vuelve con mensaje legible. */

async function parse(res: Response) {
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error || 'No se pudo completar la operación.');
    return json;
}

export async function fetchPendingEquipment(workerId: string): Promise<PendingItem[]> {
    const res = await fetch(`/api/hr/worker-separation?workerId=${encodeURIComponent(workerId)}`, {
        headers: await authHeaders(),
    });
    return (await parse(res)).pending as PendingItem[];
}

export interface SeparateInput {
    workerId: string;
    scope: SeparationScope;
    contractId?: string | null;
    /** yyyy-mm-dd, no futura. */
    effectiveDate: string;
    reasonKind: SeparationReason;
    reason: string;
}

export async function separateWorker(input: SeparateInput): Promise<{ id: string; pending: PendingItem[]; notified: number }> {
    const res = await fetch('/api/hr/worker-separation', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'separate', ...input }),
    });
    return parse(res);
}

export async function reinstateWorker(input: {
    workerId: string; scope: SeparationScope; contractId?: string | null; effectiveDate: string; reason: string;
}): Promise<{ id: string }> {
    const res = await fetch('/api/hr/worker-separation', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ action: 'reinstate', ...input }),
    });
    return parse(res);
}
