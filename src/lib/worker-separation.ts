import type { Material, MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';
import { computeToolHolderMap } from '@/modules/core/lib/tool-loans';
import { materialKind } from '@/modules/core/lib/material-kind';

/**
 * Desvinculación de trabajadores: lógica pura (sin Supabase), compartida entre
 * la pantalla, la ruta del servidor y los tests.
 */

export type SeparationScope = 'company' | 'contract';
export type SeparationReason = 'renuncia' | 'despido' | 'termino_contrato' | 'termino_obra' | 'traslado' | 'otro';

export const SEPARATION_REASON_LABEL: Record<SeparationReason, string> = {
    renuncia: 'Renuncia',
    despido: 'Despido',
    termino_contrato: 'Término de contrato',
    termino_obra: 'Término de obra o faena',
    traslado: 'Traslado a otra faena',
    otro: 'Otro motivo',
};

export const SEPARATION_SCOPE_LABEL: Record<SeparationScope, string> = {
    company: 'De la empresa',
    contract: 'De un contrato',
};

export interface PendingItem {
    materialId: string;
    name: string;
    /** Desde cuándo lo tiene (ISO). */
    since: string;
}

/**
 * Equipos y herramientas que el trabajador tiene en su poder y no ha devuelto.
 * Se parte de lo que la empresa espera ver volver: los insumos se gastan y el
 * EPP se asigna a la persona, así que no cuentan como pendientes de devolución.
 */
export function pendingEquipmentOf(
    workerId: string,
    materials: readonly Material[],
    requests: readonly MaterialRequest[],
    returns: readonly ReturnRequest[],
): PendingItem[] {
    const holders = computeToolHolderMap([...requests], [...returns]);
    const out: PendingItem[] = [];
    for (const m of materials) {
        if (m.archived || materialKind(m) !== 'equipment') continue;
        const h = holders.get(m.id);
        if (h && h.id === workerId) out.push({ materialId: m.id, name: m.name, since: h.since.toISOString() });
    }
    return out.sort((a, b) => a.since.localeCompare(b.since));
}

export interface NotifyDirectory {
    users: readonly { id: string; role: string; employmentStatus?: string | null; isActive?: boolean | null; responsibleSupervisorId?: string | null }[];
    contractWorkers: readonly { contractId: string; userId: string; endDate?: string | Date | null }[];
    warehouses: readonly { managerId?: string | null }[];
}

/**
 * A quién avisar de una desvinculación con cosas pendientes de devolución: al
 * responsable de bodega (pañoleros y encargados de pañol) y al supervisor del
 * trabajador (el responsable asignado; si no tiene, los supervisores del
 * contrato). Nunca a quien se va ni a quien lo desvincula.
 */
export function separationNotifyIds(
    workerId: string,
    actorId: string,
    contractId: string | null | undefined,
    dir: NotifyDirectory,
): string[] {
    const live = new Map(
        dir.users
            .filter(u => u.employmentStatus !== 'terminated' && u.isActive !== false)
            .map(u => [u.id, u]),
    );
    const worker = dir.users.find(u => u.id === workerId);

    const ids = new Set<string>();
    for (const u of live.values()) if (u.role === 'panolero') ids.add(u.id);
    for (const w of dir.warehouses) if (w.managerId && live.has(w.managerId)) ids.add(w.managerId);

    const responsible = worker?.responsibleSupervisorId;
    if (responsible && live.has(responsible)) {
        ids.add(responsible);
    } else {
        for (const cw of dir.contractWorkers) {
            if (contractId && cw.contractId !== contractId) continue;
            if (live.get(cw.userId)?.role === 'supervisor') ids.add(cw.userId);
        }
    }
    ids.delete(workerId);
    ids.delete(actorId);
    return [...ids];
}
