import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { Contract, ShiftSchedule, ContractWorker } from '@/modules/core/lib/data';

type Context = { user: any; tenantId: string | null };

// ── Contratos ────────────────────────────────────────────────────────────────

export async function addContract(
  data: Omit<Contract, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<Contract> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('contracts')
    .insert({
      tenant_id: tenantId,
      name: data.name,
      code: data.code || null,
      client_name: data.clientName || null,
      location: data.location || null,
      status: data.status,
      start_date: data.startDate,
      end_date: data.endDate || null,
      description: data.description || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.contracts(inserted);
}

export async function updateContract(
  id: string,
  data: Partial<Contract>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.code !== undefined) payload.code = data.code;
  if (data.clientName !== undefined) payload.client_name = data.clientName;
  if (data.location !== undefined) payload.location = data.location;
  if (data.status !== undefined) payload.status = data.status;
  if (data.startDate !== undefined) payload.start_date = data.startDate;
  if (data.endDate !== undefined) payload.end_date = data.endDate;
  if (data.description !== undefined) payload.description = data.description;

  const { error } = await supabase
    .from('contracts')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteContract(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('contracts')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Trabajadores de contrato ─────────────────────────────────────────────────

export async function addContractWorker(
  contractId: string,
  userId: string,
  shiftScheduleId: string | null,
  roleInContract: string | undefined,
  { user, tenantId }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('contract_workers')
    .insert({
      tenant_id: tenantId,
      contract_id: contractId,
      user_id: userId,
      shift_schedule_id: shiftScheduleId,
      role_in_contract: roleInContract || null,
    });

  if (error) throw error;
}

export async function removeContractWorker(
  contractWorkerId: string,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('contract_workers')
    .delete()
    .eq('id', contractWorkerId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function updateContractWorker(
  id: string,
  data: Partial<ContractWorker>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.shiftScheduleId !== undefined) payload.shift_schedule_id = data.shiftScheduleId;
  if (data.roleInContract !== undefined) payload.role_in_contract = data.roleInContract;
  if (data.endDate !== undefined) payload.end_date = data.endDate;
  if (data.startDate !== undefined) payload.start_date = data.startDate;

  const { error } = await supabase
    .from('contract_workers')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Turnos ───────────────────────────────────────────────────────────────────

export async function addShiftSchedule(
  data: Omit<ShiftSchedule, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<ShiftSchedule> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('shift_schedules')
    .insert({
      tenant_id: tenantId,
      name: data.name,
      shift_type: data.shiftType,
      days_on: data.daysOn,
      days_off: data.daysOff,
      work_start: data.workStart,
      work_end: data.workEnd,
      is_night_shift: data.isNightShift,
      lunch_start: data.lunchStart || null,
      lunch_end: data.lunchEnd || null,
      rotation_reference_date: data.rotationReferenceDate,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.shift_schedules(inserted);
}

export async function updateShiftSchedule(
  id: string,
  data: Partial<ShiftSchedule>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.shiftType !== undefined) payload.shift_type = data.shiftType;
  if (data.daysOn !== undefined) payload.days_on = data.daysOn;
  if (data.daysOff !== undefined) payload.days_off = data.daysOff;
  if (data.workStart !== undefined) payload.work_start = data.workStart;
  if (data.workEnd !== undefined) payload.work_end = data.workEnd;
  if (data.isNightShift !== undefined) payload.is_night_shift = data.isNightShift;
  if (data.lunchStart !== undefined) payload.lunch_start = data.lunchStart;
  if (data.lunchEnd !== undefined) payload.lunch_end = data.lunchEnd;
  if (data.rotationReferenceDate !== undefined) payload.rotation_reference_date = data.rotationReferenceDate;

  const { error } = await supabase
    .from('shift_schedules')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteShiftSchedule(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('shift_schedules')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}
