// Posesión de herramientas (activos usage_type 'Herramienta Menor') derivada
// del historial real de movimientos: solicitudes de material entregadas
// (status 'approved') y devoluciones completadas. Es el mismo modelo de
// eventos que usa pagnol/movimientos; tool_logs quedó como historial legado
// de solo lectura tras la migración tools→materials.

import type { Material, MaterialRequest, ReturnRequest, User } from './data';

// Solicitudes antiguas guardaban un solo material plano en vez de items[].
type CompatibleMaterialRequest = MaterialRequest & {
  materialId?: string;
  quantity?: number;
};

export interface ToolHolder {
  id: string;
  name: string;
  /** Fecha del último evento de salida (entrega) del activo. */
  since: Date;
}

export interface ActiveToolLoan extends ToolHolder {
  materialId: string;
  materialName: string;
}

/**
 * Reconstruye quién tiene cada material en su poder (materialId → holder)
 * recorriendo entregas y devoluciones en orden cronológico.
 */
export function computeToolHolderMap(
  requests: MaterialRequest[] | undefined,
  returnRequests: ReturnRequest[] | undefined,
  users?: User[],
): Map<string, ToolHolder> {
  type Ev = { time: number; kind: 'out' | 'in'; assetIds: string[]; holderId: string; holderName?: string };
  const evs: Ev[] = [];
  const usersById = new Map((users || []).map((u) => [u.id, u]));

  ((requests || []) as CompatibleMaterialRequest[]).forEach((r) => {
    if (r.status !== 'approved') return;
    const items = r.items && Array.isArray(r.items)
      ? r.items
      : r.materialId ? [{ materialId: r.materialId, quantity: r.quantity || 1 }] : [];
    const holderId = r.receivedByUserId
      || (r.deliveryMode === 'directed' ? r.beneficiaryId : null)
      || r.supervisorId;
    const holderName = r.receivedByUserName || r.beneficiaryName || r.userName;
    evs.push({
      time: new Date((r.approvalDate || r.createdAt) as any).getTime(),
      kind: 'out',
      assetIds: items.map((i) => i.materialId),
      holderId: holderId || r.supervisorId,
      holderName: holderName || undefined,
    });
  });

  ((returnRequests || []) as ReturnRequest[]).forEach((r) => {
    if (r.status !== 'completed') return;
    evs.push({
      time: new Date((r.completionDate || r.createdAt) as any).getTime(),
      kind: 'in',
      assetIds: [r.materialId],
      holderId: r.supervisorId,
    });
  });

  evs.sort((a, b) => a.time - b.time);
  const map = new Map<string, ToolHolder>();
  evs.forEach((ev) => ev.assetIds.forEach((id) => {
    if (ev.kind === 'out') {
      map.set(id, {
        id: ev.holderId,
        name: ev.holderName || usersById.get(ev.holderId)?.name || 'Desconocido',
        since: new Date(ev.time),
      });
    } else {
      map.delete(id);
    }
  }));
  return map;
}

/**
 * Préstamos abiertos de herramientas: materiales 'Herramienta Menor' que hoy
 * están en poder de alguien, ordenados del préstamo más antiguo al más nuevo.
 */
export function computeActiveToolLoans(
  materials: Material[] | undefined,
  requests: MaterialRequest[] | undefined,
  returnRequests: ReturnRequest[] | undefined,
  users?: User[],
): ActiveToolLoan[] {
  const holders = computeToolHolderMap(requests, returnRequests, users);
  const loans: ActiveToolLoan[] = [];
  (materials || []).forEach((m) => {
    if (m.usageType !== 'Herramienta Menor' || m.archived) return;
    const holder = holders.get(m.id);
    if (holder) loans.push({ ...holder, materialId: m.id, materialName: m.name });
  });
  return loans.sort((a, b) => a.since.getTime() - b.since.getTime());
}
