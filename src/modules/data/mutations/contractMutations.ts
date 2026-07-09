import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { Client, Contract, ShiftSchedule, ContractWorker } from '@/modules/core/lib/data';

import type { MutationContext as Context } from './context';

// ── Clientes ─────────────────────────────────────────────────────────────────
// Jerarquía: Empresa (tenant) → Cliente → Contratos.

export async function addClient(
  data: Omit<Client, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<Client> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('clients')
    .insert({
      tenant_id: tenantId,
      name: data.name.trim(),
      rut: data.rut || null,
      contact_name: data.contactName || null,
      contact_email: data.contactEmail || null,
      contact_phone: data.contactPhone || null,
      notes: data.notes || null,
      status: data.status || 'active',
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.clients(inserted);
}

export async function updateClient(
  id: string,
  data: Partial<Client>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.name !== undefined) payload.name = data.name.trim();
  if (data.rut !== undefined) payload.rut = data.rut || null;
  if (data.contactName !== undefined) payload.contact_name = data.contactName || null;
  if (data.contactEmail !== undefined) payload.contact_email = data.contactEmail || null;
  if (data.contactPhone !== undefined) payload.contact_phone = data.contactPhone || null;
  if (data.notes !== undefined) payload.notes = data.notes || null;
  if (data.status !== undefined) payload.status = data.status;

  const { error } = await supabase
    .from('clients')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select();

  if (error) throw error;
}

export async function deleteClient(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  // Los contratos del cliente quedan con client_id = NULL (ON DELETE SET NULL),
  // no se borran. El caller decide si eso es aceptable (avisar en la UI).
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

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
      client_id: data.clientId || null,
      client_name: data.clientName || null, // denormalizado para vistas legacy
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
  if (data.clientId !== undefined) payload.client_id = data.clientId || null;
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
  rotationStartDate: string | null,
  { user, tenantId }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const payload: Record<string, any> = {
    tenant_id: tenantId,
    contract_id: contractId,
    user_id: userId,
    shift_schedule_id: shiftScheduleId,
    role_in_contract: roleInContract || null,
  };
  // Ancla del ciclo de ESTE trabajador; se omite cuando no aplica para no
  // romper el insert si la migración de la columna aún no se ejecuta.
  if (shiftScheduleId && rotationStartDate) payload.rotation_start_date = rotationStartDate;

  const { error } = await supabase.from('contract_workers').insert(payload);

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
  if (data.rotationStartDate !== undefined) payload.rotation_start_date = data.rotationStartDate;

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
