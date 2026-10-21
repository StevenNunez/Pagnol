import type { CompatibleMaterialRequest } from '@/components/pagnol-requests/request-shared';
import { withdrawalStage, type WithdrawalStage } from '@/components/pagnol-requests/withdrawal-queues';

// ── Pipeline desde el punto de vista del SOLICITANTE ────────────────────────
// El campo `status` de la BD solo distingue pending/approved/rejected, pero
// eso oculta dos preguntas clave que el supervisor necesita responder de un
// vistazo: "¿a quién le toca mover esto?" y "¿ya puedo ir a buscarlo?".

export type SupervisorStage = 'waiting_adc' | 'queued' | 'ready_pickup' | 'delivered' | 'rejected';

// El estado sale de `withdrawalStage` (una sola definición para todas las pantallas); aquí sólo se le
// pone el nombre que ve el solicitante.
const SUPERVISOR_STAGE: Record<WithdrawalStage, SupervisorStage> = {
    waitingAdc: 'waiting_adc', // sin autorización del ADC la solicitud ni siquiera llegó al pañol
    toApprove: 'queued',
    toDeliver: 'ready_pickup',
    delivered: 'delivered',
    rejected: 'rejected',
};

export function resolveSupervisorStage(req: CompatibleMaterialRequest): SupervisorStage {
    const stage = withdrawalStage(req);
    return stage ? SUPERVISOR_STAGE[stage] : 'waiting_adc';
}

export const STAGE_META: Record<SupervisorStage, { label: string; cls: string; hint: string }> = {
    waiting_adc: {
        label: 'Esperando ADC',
        cls: 'bg-warning-subtle text-warning',
        hint: 'El Administrador de Contrato aún no la autoriza.',
    },
    queued: {
        label: 'En cola del pañol',
        cls: 'bg-info-subtle text-info-subtle-foreground',
        hint: 'Autorizada — el pañolero debe aprobarla.',
    },
    ready_pickup: {
        label: 'Lista para retiro',
        cls: 'bg-success-subtle text-success-subtle-foreground',
        hint: 'El stock ya salió del inventario. Pasa a retirarla.',
    },
    delivered: {
        label: 'Entregada',
        cls: 'bg-muted text-muted-foreground',
        hint: 'Retiro confirmado.',
    },
    rejected: {
        label: 'Rechazada',
        cls: 'bg-destructive/10 text-destructive',
        hint: 'No se descontó inventario.',
    },
};

// Filtro de la UI: colapsa waiting_adc + queued en "En trámite" (cada tarjeta
// ya distingue cuál de las dos es vía StageBadge; no vale la pena un chip por cada una).
export type HistoryFilter = 'all' | 'in_progress' | 'ready_pickup' | 'delivered' | 'rejected';

export function matchesHistoryFilter(stage: SupervisorStage, filter: HistoryFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'in_progress') return stage === 'waiting_adc' || stage === 'queued';
    return stage === filter;
}

export const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'in_progress', label: 'En trámite' },
    { key: 'ready_pickup', label: 'Listas para retiro' },
    { key: 'delivered', label: 'Entregadas' },
    { key: 'rejected', label: 'Rechazadas' },
];
