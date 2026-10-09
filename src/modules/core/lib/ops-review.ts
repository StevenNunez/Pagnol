import type { PurchaseRequest } from './data';

/**
 * RFC-006 F1: ¿este requerimiento pasa por el Jefe de Operaciones antes del ADC?
 * Las compras a proveedor sí. El suministro del cliente no es una compra (no sale
 * plata propia) y el RQ derivado de un arriendo se revisa en su solicitud de
 * arriendo, que es la dueña del flujo.
 */
export function needsOpsReview(req: Pick<PurchaseRequest, 'requestTarget' | 'rentalRequestId'>): boolean {
    return req.requestTarget !== 'client' && !req.rentalRequestId;
}
