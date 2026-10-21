import type { MaterialRequest } from '@/modules/core/lib/data';

/**
 * En qué paso está cada retiro, visto desde el pañol. Una sola definición para
 * la bandeja, el panel principal y el número del menú, así los tres cuentan
 * lo mismo.
 *
 *   waitingAdc → toApprove → toDeliver → delivered
 *                         ↘ rejected
 */
export interface WithdrawalQueues<T extends MaterialRequest = MaterialRequest> {
    /** Pendientes que el ADC todavía no autoriza: el pañol no puede tocarlas. */
    waitingAdc: T[];
    /** Autorizadas por el ADC: el pañolero aprueba el despacho (descuenta stock). */
    toApprove: T[];
    /** Despacho aprobado, falta que el trabajador las retire en el pañol. */
    toDeliver: T[];
    /** Entregadas al trabajador. */
    delivered: T[];
    rejected: T[];
}

export type WithdrawalStage = keyof WithdrawalQueues;

/**
 * EL cálculo del estado de un retiro. La bandeja del pañol, el panel, el menú, la vista del
 * solicitante (`resolveSupervisorStage`) y los reportes lo derivan de aquí: antes cada uno tenía su
 * propia copia con reglas apenas distintas, y «dónde está mi retiro» podía responderse distinto según
 * la pantalla. Un estado desconocido da null (nunca se asume «aprobado»).
 */
export function withdrawalStage(r: Pick<MaterialRequest, 'status' | 'adcAuthorizedAt' | 'deliveryDate'>): WithdrawalStage | null {
    if (r.status === 'pending') return r.adcAuthorizedAt ? 'toApprove' : 'waitingAdc';
    if (r.status === 'approved') return r.deliveryDate ? 'delivered' : 'toDeliver';
    if (r.status === 'rejected') return 'rejected';
    return null;
}

export function withdrawalQueues<T extends MaterialRequest>(requests: readonly T[] | null | undefined): WithdrawalQueues<T> {
    const q: WithdrawalQueues<T> = { waitingAdc: [], toApprove: [], toDeliver: [], delivered: [], rejected: [] };
    for (const r of requests || []) {
        const stage = withdrawalStage(r);
        if (stage) q[stage].push(r);
    }
    return q;
}

/** Abre la entrega con verificación de identidad de esta solicitud en Transacciones. */
export const deliveryHref = (requestId: string) => `/dashboard/pagnol/movimientos?entregar=${encodeURIComponent(requestId)}`;
