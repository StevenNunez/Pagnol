import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { WorkOrder } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import { enqueue, putMirror, deleteMirror, getMirror, removePendingFor } from '@/modules/offline/outbox';
import { isOffline, isNetworkError } from '@/modules/offline/net';

const isUUID = (v: any) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const TABLE = 'work_orders';

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type WorkOrderInput = Partial<WorkOrder>;

function toRow(data: WorkOrderInput, ctx: Context): Record<string, any> {
  const row: Record<string, any> = { updated_by: ctx.user?.id || null, updated_at: new Date().toISOString() };

  if (data.otNumber !== undefined) row.ot_number = data.otNumber;
  if (data.client !== undefined) row.client = data.client;
  if (data.contractNumber !== undefined) row.contract_number = data.contractNumber || null;
  if (data.area !== undefined) row.area = data.area || null;
  if (data.location !== undefined) row.location = data.location || null;
  if (data.specialty !== undefined) row.specialty = data.specialty || null;
  if (data.milestone !== undefined) row.milestone = data.milestone || null;
  if (data.supervisorId !== undefined) row.supervisor_id = isUUID(data.supervisorId) ? data.supervisorId : null;
  if (data.supervisorName !== undefined) row.supervisor_name = data.supervisorName;
  if (data.shift !== undefined) row.shift = data.shift || null;
  if (data.workSchedule !== undefined) row.work_schedule = data.workSchedule || null;
  if (data.workDate !== undefined) row.work_date = data.workDate;
  if (data.description !== undefined) row.description = data.description;
  if (data.labor !== undefined) row.labor = data.labor;
  if (data.equipment !== undefined) row.equipment = data.equipment;
  if (data.materials !== undefined) row.materials = data.materials;
  if (data.photos !== undefined) row.photos = data.photos;
  if (data.plannedPercent !== undefined) row.planned_percent = data.plannedPercent;
  if (data.executedPercent !== undefined) row.executed_percent = data.executedPercent;
  if (data.status !== undefined) row.status = data.status;

  return row;
}

export async function createWorkOrder(data: WorkOrderInput, ctx: Context): Promise<WorkOrder> {
  const { user, tenantId } = ctx;
  if (!user || !tenantId) throw new Error('No autenticado.');

  // UUID generado en el cliente → el insert es idempotente (upsert por id) y la
  // sincronización puede reintentarse sin duplicar.
  const id = newId();
  const now = new Date().toISOString();

  const baseRow = {
    id,
    tenant_id: tenantId,
    ot_number: data.otNumber || '',
    client: data.client || '',
    contract_number: data.contractNumber || null,
    area: data.area || null,
    location: data.location || null,
    specialty: data.specialty || null,
    milestone: data.milestone || null,
    supervisor_id: isUUID(data.supervisorId) ? data.supervisorId : user.id,
    supervisor_name: data.supervisorName || user.name,
    shift: data.shift || null,
    work_schedule: data.workSchedule || null,
    work_date: data.workDate || new Date().toISOString().slice(0, 10),
    description: data.description || '',
    labor: data.labor || [],
    equipment: data.equipment || [],
    materials: data.materials || [],
    photos: data.photos || [],
    planned_percent: data.plannedPercent || 0,
    executed_percent: data.executedPercent || 0,
    status: data.status || 'draft',
    created_by: user.id,
    created_by_name: user.name,
    updated_by: user.id,
    created_at: now,
    updated_at: now,
  };

  // Objeto optimista (camelCase) para devolver/guardar en el espejo offline.
  const optimistic = mappers.work_orders(baseRow);

  // Sin conexión: encola + espejo, devuelve el optimista (la app navega a la OT).
  if (isOffline()) {
    await enqueue({ op: 'insert', table: TABLE, recordId: id, payload: baseRow, tenantId, userId: user.id });
    await putMirror(TABLE, id, tenantId, optimistic);
    return optimistic;
  }

  try {
    const { data: inserted, error } = await supabase
      .from('work_orders')
      .insert(baseRow)
      .select('*')
      .single();
    if (error) throw error;
    return mappers.work_orders(inserted);
  } catch (e) {
    // Falla de red en pleno envío: degradar a offline sin perder la OT.
    if (isNetworkError(e)) {
      await enqueue({ op: 'insert', table: TABLE, recordId: id, payload: baseRow, tenantId, userId: user.id });
      await putMirror(TABLE, id, tenantId, optimistic);
      return optimistic;
    }
    throw e;
  }
}

export async function updateWorkOrder(id: string, data: WorkOrderInput, ctx: Context): Promise<void> {
  const { user, tenantId } = ctx;
  const row = toRow(data, ctx);

  const queueOffline = async () => {
    if (!user || !tenantId) throw new Error('No autenticado.');
    // Mezcla la edición sobre el espejo existente para mantener el registro completo.
    const existing = (await getMirror<WorkOrder>(TABLE, tenantId)).find((w) => w.id === id);
    const merged = { ...(existing || {}), ...(data as Partial<WorkOrder>), id, tenantId } as WorkOrder;
    await enqueue({ op: 'update', table: TABLE, recordId: id, payload: row, tenantId, userId: user.id });
    await putMirror(TABLE, id, tenantId, merged);
  };

  if (isOffline() && user && tenantId) {
    await queueOffline();
    return;
  }

  try {
    const { error } = await supabase.from('work_orders').update(row).eq('id', id);
    if (error) throw error;
  } catch (e) {
    if (isNetworkError(e) && user && tenantId) {
      await queueOffline();
      return;
    }
    throw e;
  }
}

export async function deleteWorkOrder(id: string, ctx: Context): Promise<void> {
  const { user, tenantId } = ctx;

  const queueOffline = async () => {
    if (!user || !tenantId) throw new Error('No autenticado.');
    // Si el registro nunca llegó al servidor (insert pendiente), basta con
    // cancelar lo encolado; no hace falta un delete remoto.
    const { hadInsert } = await removePendingFor(TABLE, id);
    await deleteMirror(TABLE, id);
    if (!hadInsert) {
      await enqueue({ op: 'delete', table: TABLE, recordId: id, tenantId, userId: user.id });
    }
  };

  if (isOffline() && user && tenantId) {
    await queueOffline();
    return;
  }

  try {
    const { error } = await supabase.from('work_orders').delete().eq('id', id);
    if (error) throw error;
    // Limpia cualquier rastro local del registro ya borrado en el servidor.
    await deleteMirror(TABLE, id);
  } catch (e) {
    if (isNetworkError(e) && user && tenantId) {
      await queueOffline();
      return;
    }
    throw e;
  }
}
