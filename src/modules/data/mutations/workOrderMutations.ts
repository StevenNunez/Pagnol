import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { WorkOrder } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const isUUID = (v: any) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

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

  const baseRow = {
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
  };

  const { data: inserted, error } = await supabase
    .from('work_orders')
    .insert(baseRow)
    .select('*')
    .single();
  if (error) throw error;
  return mappers.work_orders(inserted);
}

export async function updateWorkOrder(id: string, data: WorkOrderInput, ctx: Context): Promise<void> {
  const row = toRow(data, ctx);
  const { error } = await supabase.from('work_orders').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteWorkOrder(id: string, _ctx: Context): Promise<void> {
  const { error } = await supabase.from('work_orders').delete().eq('id', id);
  if (error) throw error;
}
