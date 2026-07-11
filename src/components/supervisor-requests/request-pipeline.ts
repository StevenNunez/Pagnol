import type { CompatibleMaterialRequest } from '@/components/pagnol-requests/request-shared';

// ── Pipeline desde el punto de vista del SOLICITANTE ────────────────────────
// El campo `status` de la BD solo distingue pending/approved/rejected, pero
// eso oculta dos preguntas clave que el supervisor necesita responder de un
// vistazo: "¿a quién le toca mover esto?" y "¿ya puedo ir a buscarlo?".

export type SupervisorStage = 'waiting_adc' | 'queued' | 'ready_pickup' | 'delivered' | 'rejected';

export function resolveSupervisorStage(req: CompatibleMaterialRequest): SupervisorStage {
    if (req.status === 'rejected') return 'rejected';
    if (req.status === 'pending') {
        // Gate ADC: sin adcAuthorizedAt, la solicitud ni siquiera llegó al pañol.
        return req.adcAuthorizedAt ? 'queued' : 'waiting_adc';
    }
    // approved
    return req.deliveryDate ? 'delivered' : 'ready_pickup';
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
