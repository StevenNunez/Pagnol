import type { PurchaseRequest } from '@/modules/core/lib/data';

// ── Pipeline desde el punto de vista del SOLICITANTE ────────────────────────
// `status` ya trae más granularidad que material_requests (pending/approved/
// rejected/ordered/received/batched), pero sigue sin distinguir "esperando
// ADC" de "en revisión de Abastecimiento" dentro de 'pending' — mismo defecto
// que resolvimos en supervisor/request.
//
// Las solicitudes de SUMINISTRO DEL CLIENTE (requestTarget='client') tienen un
// tramo final distinto: tras la autorización del ADC no van a Abastecimiento —
// el propio supervisor las envía por correo al cliente ('to_send' → 'ordered').

export type PurchaseStage = 'waiting_adc' | 'in_review' | 'to_send' | 'approved' | 'ordered' | 'received' | 'rejected';

export function isClientSupply(req: PurchaseRequest): boolean {
    return req.requestTarget === 'client';
}

export function resolvePurchaseStage(req: PurchaseRequest): PurchaseStage {
    if (req.status === 'rejected') return 'rejected';
    if (req.status === 'received') return 'received';
    if (req.status === 'ordered') return 'ordered';
    // 'batched' = agrupada en un lote de compra para un proveedor; sigue
    // siendo "aprobada, en gestión" desde la mirada del solicitante.
    if (req.status === 'approved' || req.status === 'batched') return 'approved';
    // pending
    if (!req.adcAuthorizedAt) return 'waiting_adc';
    // Autorizada: la compra queda en revisión de Abastecimiento; el suministro
    // del cliente queda en manos del supervisor para enviarlo por correo.
    return isClientSupply(req) ? 'to_send' : 'in_review';
}

export const STAGE_META: Record<PurchaseStage, { label: string; cls: string; hint: string }> = {
    waiting_adc: {
        label: 'Esperando ADC',
        cls: 'bg-warning-subtle text-warning',
        hint: 'El Administrador de Contrato aún no la autoriza.',
    },
    in_review: {
        label: 'En revisión',
        cls: 'bg-info-subtle text-info-subtle-foreground',
        hint: 'Autorizada — Abastecimiento debe aprobarla.',
    },
    to_send: {
        label: 'Por enviar al cliente',
        cls: 'bg-warning-subtle text-warning',
        hint: 'Autorizada por el ADC — envíala por correo al cliente.',
    },
    approved: {
        label: 'Aprobada',
        cls: 'bg-success-subtle text-success-subtle-foreground',
        hint: 'Aprobada — en gestión de compra con el proveedor.',
    },
    ordered: {
        label: 'Ordenada',
        cls: 'bg-info-subtle text-info-subtle-foreground',
        hint: 'Orden de compra emitida — en camino.',
    },
    received: {
        label: 'Recibida',
        cls: 'bg-muted text-muted-foreground',
        hint: 'Ingresó al inventario.',
    },
    rejected: {
        label: 'Rechazada',
        cls: 'bg-destructive/10 text-destructive',
        hint: 'No se procesará la compra.',
    },
};

// Variantes de texto para el tramo del cliente (mismo stage, otro significado).
export const CLIENT_STAGE_HINT: Partial<Record<PurchaseStage, string>> = {
    ordered: 'Enviada al cliente — esperando su entrega.',
    received: 'El cliente entregó — ingresó como activo del cliente.',
};

export type HistoryFilter = 'all' | 'in_progress' | 'approved' | 'ordered' | 'received' | 'rejected';

export function matchesHistoryFilter(stage: PurchaseStage, filter: HistoryFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'in_progress') return stage === 'waiting_adc' || stage === 'in_review' || stage === 'to_send';
    return stage === filter;
}

export const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'in_progress', label: 'En trámite' },
    { key: 'approved', label: 'Aprobadas' },
    { key: 'ordered', label: 'Ordenadas' },
    { key: 'received', label: 'Recibidas' },
    { key: 'rejected', label: 'Rechazadas' },
];

/** Clave de agrupación del historial: mismo batchId = mismo pedido; sin
 * batchId, cada fila es su propio grupo (comportamiento pre-migración). */
export function groupKey(req: PurchaseRequest): string {
    return req.batchId || req.id;
}
