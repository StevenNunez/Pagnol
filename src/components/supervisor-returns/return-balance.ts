import type { Material, MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';

// Custodio real de una solicitud aprobada: quien recibió (biometría/QR) >
// beneficiario dirigido > solicitante. Misma fórmula que computeToolHolderMap
// (tool-loans.ts) y la copia server-side en materialRequestMutations.ts — para
// que "cuánto tengo pendiente de devolver" nunca contradiga "quién tiene esto"
// en Activos/Reportes.
export function holderOf(r: { receivedByUserId?: string | null; deliveryMode?: string | null; beneficiaryId?: string | null; supervisorId: string }): string {
    return r.receivedByUserId || (r.deliveryMode === 'directed' ? r.beneficiaryId ?? null : null) || r.supervisorId;
}

export const balanceKey = (materialId: string, contractId?: string | null) => `${materialId}::${contractId ?? 'pool'}`;

export interface ReturnBalanceItem {
    materialId: string;
    materialName: string;
    unit: string;
    contractId: string | null;
    contractName: string | null;
    /** Cuánto queda por devolver: tomado (aprobado, con custodia) − ya devuelto (pendiente+completado). */
    outstanding: number;
    /** Retiro más antiguo aún no devuelto de este material/contrato. */
    since: Date;
}

/**
 * Saldo de devolución del usuario, agrupado por (material, contrato) — NO por
 * fecha: un mismo material es fungible, no importa qué día se retiró. Separar
 * por contrato (en vez de mezclar y caer al pool si hay más de uno, como hacía
 * la versión anterior) evita reingresos silenciosos al contrato equivocado.
 * Esta es la vista OPTIMISTA para la UI; el servidor recalcula el saldo real
 * antes de aceptar el envío (ver computeReturnBalances en la mutación).
 */
export function computeReturnBalanceItems(
    userId: string,
    requests: MaterialRequest[] | undefined,
    returnRequests: ReturnRequest[] | undefined,
    materialMap: Map<string, Material>,
): ReturnBalanceItem[] {
    type Acc = { materialId: string; contractId: string | null; contractName: string | null; taken: number; since: Date };
    const acc = new Map<string, Acc>();

    (requests || []).forEach(r => {
        if (r.status !== 'approved') return;
        if (holderOf(r) !== userId) return;
        const since = new Date((r.deliveryDate ?? r.approvalDate ?? r.createdAt) as any);
        (r.items || []).forEach(item => {
            const key = balanceKey(item.materialId, r.contractId);
            const entry = acc.get(key) || { materialId: item.materialId, contractId: r.contractId ?? null, contractName: r.contractName ?? null, taken: 0, since };
            entry.taken += item.quantity;
            if (since < entry.since) entry.since = since;
            acc.set(key, entry);
        });
    });

    // Pendiente O completada resta del saldo — no se puede reclamar dos veces
    // la misma devolución mientras la primera espera revisión del pañolero.
    const returned = new Map<string, number>();
    (returnRequests || []).forEach(r => {
        if (r.supervisorId !== userId || r.status === 'rejected') return;
        const key = balanceKey(r.materialId, r.contractId);
        returned.set(key, (returned.get(key) || 0) + r.quantity);
    });

    const items: ReturnBalanceItem[] = [];
    acc.forEach((entry, key) => {
        const outstanding = entry.taken - (returned.get(key) || 0);
        if (outstanding <= 0) return;
        const material = materialMap.get(entry.materialId);
        items.push({
            materialId: entry.materialId,
            materialName: material?.name || 'Material desconocido',
            unit: material?.unit || 'unidad',
            contractId: entry.contractId,
            contractName: entry.contractName,
            outstanding,
            since: entry.since,
        });
    });
    return items.sort((a, b) => a.materialName.localeCompare(b.materialName));
}
