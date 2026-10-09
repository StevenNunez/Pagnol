/**
 * Lógica pura de la revisión posterior de retiros (sin Supabase, testeable).
 *
 * Un retiro entregado en modo 'post' trae `requiresReview`. Su estado NO se
 * guarda en ninguna columna: se deriva de las filas append-only de
 * `withdrawal_reviews`, igual que el saldo del ledger se deriva de sus asientos.
 */

export interface ReviewableItem { materialId: string; quantity: number }

export interface ReviewableRequest {
    id: string;
    requiresReview?: boolean;
    contractId?: string | null;
    /** Quien retiró (en las entregas directas es el trabajador). */
    supervisorId: string;
    items: ReviewableItem[];
}

export interface ReviewFact {
    requestId: string;
    materialId: string | null;
    decision: 'authorized' | 'unauthorized';
}

export type ReviewState = 'pending' | 'partial' | 'reviewed';

export interface RequestReviewSummary {
    state: ReviewState;
    /** Líneas del retiro sin decisión todavía. */
    pendingLines: number;
    unauthorizedLines: number;
    /** materialId → decisión ya tomada. */
    decisions: Map<string, 'authorized' | 'unauthorized'>;
}

/** Agrupa los hechos por retiro para no recorrer la lista entera por cada uno. */
export function indexReviews<T extends ReviewFact>(reviews: readonly T[]): Map<string, T[]> {
    const byRequest = new Map<string, T[]>();
    for (const r of reviews) {
        const list = byRequest.get(r.requestId);
        if (list) list.push(r);
        else byRequest.set(r.requestId, [r]);
    }
    return byRequest;
}

export function summarizeReview(req: ReviewableRequest, facts: readonly ReviewFact[] = []): RequestReviewSummary {
    const decisions = new Map<string, 'authorized' | 'unauthorized'>();
    for (const f of facts) {
        // UNIQUE(request_id, material_id) en la base: la primera es la única.
        if (f.materialId && !decisions.has(f.materialId)) decisions.set(f.materialId, f.decision);
    }
    // Un mismo material puede venir en dos líneas del JSON; se revisa una vez.
    const lineIds = [...new Set(req.items.map(i => i.materialId))];
    const pendingLines = lineIds.filter(id => !decisions.has(id)).length;
    const unauthorizedLines = lineIds.filter(id => decisions.get(id) === 'unauthorized').length;
    const state: ReviewState =
        pendingLines === 0 ? 'reviewed' : pendingLines === lineIds.length ? 'pending' : 'partial';
    return { state, pendingLines, unauthorizedLines, decisions };
}

/**
 * ¿Puede este usuario revisar este retiro?
 *  - nunca el propio retiro (nadie se autoriza a sí mismo);
 *  - quien ve todos los contratos (oficina/administración) revisa cualquiera;
 *  - el resto, sólo los retiros imputados a un contrato al que está vinculado.
 *    Un retiro sin contrato queda para quien ve todos.
 */
export function canReviewRequest(
    req: ReviewableRequest,
    reviewer: { id: string; seesAllContracts: boolean; contractIds: ReadonlySet<string> },
): boolean {
    if (!req.requiresReview) return false;
    if (req.supervisorId === reviewer.id) return false;
    if (reviewer.seesAllContracts) return true;
    return !!req.contractId && reviewer.contractIds.has(req.contractId);
}

/**
 * A quién avisar de un retiro nuevo: los supervisores vinculados al contrato
 * del retiro; si no hay ninguno (o el retiro no tiene contrato), los
 * administradores. Nunca a quien retiró.
 */
export function reviewerIdsFor(
    contractId: string | null | undefined,
    withdrawnBy: string,
    users: readonly { id: string; role: string }[],
    contractWorkers: readonly { contractId: string; userId: string }[],
): string[] {
    const roleOf = new Map(users.map(u => [u.id, u.role]));
    // Se excluye a quien retiró ANTES de decidir el respaldo: si el único
    // supervisor del contrato es él mismo, el aviso tiene que ir a administración.
    const supervisors = contractId
        ? [...new Set(contractWorkers
            .filter(cw => cw.contractId === contractId && roleOf.get(cw.userId) === 'supervisor')
            .map(cw => cw.userId))].filter(id => id !== withdrawnBy)
        : [];
    if (supervisors.length > 0) return supervisors;
    return users.filter(u => u.role === 'administrador' && u.id !== withdrawnBy).map(u => u.id);
}

// ── Etapa 3: observaciones (líneas "no autorizadas") ─────────────────────────

export interface Observation {
    reviewId: string;
    requestId: string;
    /** Quien retiró. */
    workerId: string;
    materialId: string | null;
    quantity: number;
    /** Fecha del retiro: una devolución anterior no puede cerrar esto. */
    withdrawnAt: Date;
}

export interface ReturnFact {
    id: string;
    internalCode?: string;
    workerId: string;
    materialId: string;
    quantity: number;
    status: string;
    at: Date;
}

export type ObservationStatus = 'open' | 'returned' | 'justified';

export interface ObservationState {
    status: ObservationStatus;
    /** Unidades devueltas imputadas a esta observación (0..quantity). */
    returnedQty: number;
    /** La devolución que completó la cantidad (si quedó 'returned'). */
    closingReturn?: ReturnFact;
}

/**
 * Estado de cada observación.
 *
 * - Una justificación de administración la cierra siempre ('justified').
 * - Si no, se cierra sola cuando el trabajador devolvió ese material en una
 *   devolución COMPLETADA, posterior al retiro, por al menos la cantidad.
 *
 * Las devoluciones se reparten por (trabajador, material) en orden: la
 * observación más antigua se cubre primero y cada unidad devuelta se cuenta una
 * sola vez. Las unidades de un mismo material son intercambiables: lo que se
 * busca saber es si lo no autorizado volvió al pañol.
 */
export function resolveObservations(
    observations: readonly Observation[],
    returns: readonly ReturnFact[],
    justifiedReviewIds: ReadonlySet<string>,
): Map<string, ObservationState> {
    const out = new Map<string, ObservationState>();
    const key = (w: string, m: string) => `${w}|${m}`;

    const pools = new Map<string, { r: ReturnFact; left: number }[]>();
    for (const r of returns) {
        if (r.status !== 'completed' || r.quantity <= 0) continue;
        const k = key(r.workerId, r.materialId);
        const list = pools.get(k) || [];
        list.push({ r, left: r.quantity });
        pools.set(k, list);
    }
    for (const list of pools.values()) list.sort((a, b) => a.r.at.getTime() - b.r.at.getTime());

    const sorted = [...observations].sort((a, b) => a.withdrawnAt.getTime() - b.withdrawnAt.getTime());
    for (const o of sorted) {
        if (justifiedReviewIds.has(o.reviewId)) {
            out.set(o.reviewId, { status: 'justified', returnedQty: 0 });
            continue;
        }
        let need = o.quantity;
        let closing: ReturnFact | undefined;
        const pool = o.materialId ? pools.get(key(o.workerId, o.materialId)) : undefined;
        for (const slot of pool || []) {
            if (need <= 0) break;
            if (slot.left <= 0 || slot.r.at.getTime() < o.withdrawnAt.getTime()) continue;
            const take = Math.min(slot.left, need);
            slot.left -= take;
            need -= take;
            closing = slot.r;
        }
        const returnedQty = o.quantity - need;
        out.set(o.reviewId, need <= 0
            ? { status: 'returned', returnedQty, closingReturn: closing }
            : { status: 'open', returnedQty });
    }
    return out;
}
