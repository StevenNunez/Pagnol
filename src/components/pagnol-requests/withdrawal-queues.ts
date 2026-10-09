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

export function withdrawalQueues<T extends MaterialRequest>(requests: readonly T[] | null | undefined): WithdrawalQueues<T> {
    const q: WithdrawalQueues<T> = { waitingAdc: [], toApprove: [], toDeliver: [], delivered: [], rejected: [] };
    for (const r of requests || []) {
        if (r.status === 'pending') (r.adcAuthorizedAt ? q.toApprove : q.waitingAdc).push(r);
        else if (r.status === 'approved') (r.deliveryDate ? q.delivered : q.toDeliver).push(r);
        else if (r.status === 'rejected') q.rejected.push(r);
    }
    return q;
}

/** Abre la entrega con verificación de identidad de esta solicitud en Transacciones. */
export const deliveryHref = (requestId: string) => `/dashboard/pagnol/movimientos?entregar=${encodeURIComponent(requestId)}`;
