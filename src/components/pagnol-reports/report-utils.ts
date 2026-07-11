import { Material, MaterialRequest, ReturnRequest, User } from '@/modules/core/lib/data';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ReportTab = 'INVENTORY' | 'AUDIT' | 'PEOPLE' | 'ASSET_TRAIL' | 'MAINTENANCE_LOG';

/** Etapa REAL de una operación — nada de escudos inventados. */
export type TxStage = 'pending' | 'approved' | 'delivered' | 'rejected' | 'return_pending' | 'completed';

export type DisplayTransaction = {
    id: string;
    internalCode?: string;
    type: 'WITHDRAWAL' | 'RETURN';
    timestamp: Date;
    assetIds: string[];
    itemCount: number;
    site: string;
    stage: TxStage;
    /** Custodio real: quien recibió (o beneficiario dirigido), no el que aprobó. */
    holderId: string;
    holderName: string;
    /** Solicitante/supervisor cuando difiere del custodio. */
    requesterName?: string;
    contractName?: string | null;
    /** true SOLO si la entrega/devolución se concretó (deliveryDate/completed). */
    isConfirmed: boolean;
};

// ─── Estados de material (semántica honesta) ────────────────────────────────

export type AssetStatus = 'Disponible' | 'En Mantenimiento' | 'Para Baja' | 'Extraviado' | 'En Uso' | 'Agotado' | 'Stock Crítico' | 'Archivado';

/** Colores SEMÁNTICOS por estado (no por índice): verde=ok, ámbar=alerta, rojo=problema. */
export const STATUS_COLORS: Record<AssetStatus, string> = {
    'Disponible': '#22c55e',
    'En Uso': '#0ea5e9',
    'Stock Crítico': '#f59e0b',
    'En Mantenimiento': '#a855f7',
    'Agotado': '#ef4444',
    'Para Baja': '#dc2626',
    'Extraviado': '#f43f5e',
    'Archivado': '#94a3b8',
};

// Tipos de uso que se prestan y devuelven. Los consumibles JAMÁS retornan,
// así que no pueden castigar el score de un trabajador.
const RETURNABLE_TYPES = new Set(['Herramienta Menor', 'Reutilizable Controlado', 'IT Controlado', 'Retornable']);
export const isReturnable = (m?: Material | null) => !!m && RETURNABLE_TYPES.has(m.usageType || '');

/**
 * Umbral de stock crítico. Manda el minStock del material; sin minStock, el
 * fallback 5 SOLO aplica a stock que se consume por cantidad (consumibles y
 * repuestos) — un Activo Fijo o herramienta con stock 1 es normal, no crítico.
 */
export const criticalThreshold = (m: Material) => {
    if (typeof m.minStock === 'number') return m.minStock;
    const t = m.usageType || '';
    return (t === 'Consumible' || t === 'Repuesto Crítico') ? 5 : 0;
};

// ─── Formato ────────────────────────────────────────────────────────────────

export const formatCLP = (amount: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(amount);

/** $48.2M / $310K para ejes de gráficos. */
export const formatCompactCLP = (v: number) => {
    if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M`;
    if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
    return `$${v}`;
};

export const STAGE_META: Record<TxStage, { label: string; cls: string }> = {
    pending: { label: 'Pendiente', cls: 'bg-warning-subtle text-warning' },
    approved: { label: 'Aprobada', cls: 'bg-info-subtle text-info-subtle-foreground' },
    delivered: { label: 'Entregada', cls: 'bg-success-subtle text-success-subtle-foreground' },
    rejected: { label: 'Rechazada', cls: 'bg-destructive/10 text-destructive' },
    return_pending: { label: 'Devolución pendiente', cls: 'bg-warning-subtle text-warning' },
    completed: { label: 'Devuelto', cls: 'bg-success-subtle text-success-subtle-foreground' },
};

// ─── Construcción de transacciones (fuente única y honesta) ─────────────────

/**
 * Unifica solicitudes de material y devoluciones en una línea de tiempo.
 * La atribución de custodio sigue la MISMA regla que computeToolHolderMap
 * (quien recibió > beneficiario dirigido > supervisor), para que Reportes
 * nunca contradiga a la página de Activos.
 */
export function buildTransactions(
    requests: MaterialRequest[] | undefined,
    returnRequests: ReturnRequest[] | undefined,
    usersMap: Map<string, User>,
): DisplayTransaction[] {
    const list: DisplayTransaction[] = [];

    ((requests || []) as (MaterialRequest & { receivedByUserId?: string; receivedByUserName?: string; deliveryMode?: string; beneficiaryId?: string; beneficiaryName?: string })[]).forEach(r => {
        const holderId = r.receivedByUserId
            || (r.deliveryMode === 'directed' ? r.beneficiaryId : null)
            || r.supervisorId;
        const holderName = r.receivedByUserName
            || (r.deliveryMode === 'directed' ? r.beneficiaryName : null)
            || usersMap.get(holderId || '')?.name
            || r.userName
            || 'Desconocido';
        const requesterName = usersMap.get(r.supervisorId)?.name || r.userName;

        const stage: TxStage = r.status === 'rejected' ? 'rejected'
            : r.deliveryDate ? 'delivered'
                : r.status === 'approved' ? 'approved'
                    : 'pending';

        list.push({
            id: r.id,
            internalCode: r.internalCode,
            type: 'WITHDRAWAL',
            timestamp: r.createdAt ? new Date(r.createdAt as any) : new Date(),
            assetIds: (r.items || []).map(i => i.materialId),
            itemCount: (r.items || []).reduce((acc, i) => acc + (i.quantity || 1), 0),
            site: r.area,
            stage,
            holderId: holderId || r.supervisorId,
            holderName,
            requesterName: requesterName !== holderName ? requesterName : undefined,
            contractName: r.contractName,
            isConfirmed: !!r.deliveryDate,
        });
    });

    (returnRequests || []).forEach(r => {
        list.push({
            id: r.id,
            internalCode: r.internalCode,
            type: 'RETURN',
            timestamp: r.createdAt ? new Date(r.createdAt as any) : new Date(),
            assetIds: [r.materialId],
            itemCount: r.quantity || 1,
            site: r.contractName || 'Pañol',
            stage: r.status === 'completed' ? 'completed' : r.status === 'rejected' ? 'rejected' : 'return_pending',
            holderId: r.supervisorId,
            holderName: usersMap.get(r.supervisorId)?.name || r.supervisorName || 'Desconocido',
            contractName: r.contractName,
            isConfirmed: r.status === 'completed',
        });
    });

    return list.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
