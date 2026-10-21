// Eventos que Pagnol puede enviar. Deben coincidir con el CHECK
// `webhook_subscriptions_events_valid` (migración 20261019000000).
export const WEBHOOK_EVENTS = [
    'material.creado',
    'material.actualizado',
    'proveedor.creado',
    'proveedor.actualizado',
    'activo.creado',
    'activo.actualizado',
    'activo.dado_de_baja',
    'stock.bajo_minimo',
    'compra.recibida',
    'compra.recepcion_corregida',
    'solicitud_compra.creada',
    'solicitud_compra.aprobada',
    'solicitud_compra.rechazada',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

/** Qué recurso de la API lleva en `data` cada evento. */
export function eventResource(type: WebhookEventType): 'material' | 'proveedor' | 'activo' | 'stock' | 'compra' | 'solicitud_compra' {
    return type.split('.')[0] as 'material' | 'proveedor' | 'activo' | 'stock' | 'compra' | 'solicitud_compra';
}

// Backoff del contrato: ≈ 1 min, 5 min, 30 min, 2 h, 6 h, 24 h. Pasado el último
// escalón se sigue reintentando cada 24 h hasta que la entrega cumple
// MAX_AGE_MS: entonces se da por fallida (queda registrada, no se pierde en silencio).
const MINUTE = 60_000;
export const RETRY_DELAYS_MS = [1 * MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 360 * MINUTE, 1440 * MINUTE] as const;
export const MAX_AGE_MS = 7 * 24 * 60 * MINUTE;

export type RetryPlan =
    | { status: 'pending'; nextAttemptAt: Date }
    | { status: 'failed' };

/**
 * Qué hacer con una entrega después de un intento fallido.
 * @param failedAttempts intentos fallidos contando el que acaba de fallar (≥ 1)
 */
export function planRetry(failedAttempts: number, createdAt: Date, now: Date): RetryPlan {
    const delay = RETRY_DELAYS_MS[Math.min(failedAttempts, RETRY_DELAYS_MS.length) - 1];
    const next = new Date(now.getTime() + delay);
    if (next.getTime() - createdAt.getTime() > MAX_AGE_MS) return { status: 'failed' };
    return { status: 'pending', nextAttemptAt: next };
}
