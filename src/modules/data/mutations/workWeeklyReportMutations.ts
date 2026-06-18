import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { WorkWeeklyReport } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const isUUID = (v: any) =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type WeeklyInput = Partial<WorkWeeklyReport>;

function toRow(data: WeeklyInput, ctx: Context): Record<string, any> {
  const row: Record<string, any> = { updated_by: ctx.user?.id || null, updated_at: new Date().toISOString() };

  if (data.title !== undefined) row.title = data.title;
  if (data.client !== undefined) row.client = data.client;
  if (data.faena !== undefined) row.faena = data.faena;
  if (data.obra !== undefined) row.obra = data.obra || null;
  if (data.contractNumber !== undefined) row.contract_number = data.contractNumber || null;
  if (data.area !== undefined) row.area = data.area || null;
  if (data.specialty !== undefined) row.specialty = data.specialty || null;
  if (data.supervisorId !== undefined) row.supervisor_id = isUUID(data.supervisorId) ? data.supervisorId : null;
  if (data.supervisorName !== undefined) row.supervisor_name = data.supervisorName;
  if (data.startDate !== undefined) row.start_date = data.startDate;
  if (data.endDate !== undefined) row.end_date = data.endDate;
  if (data.consolidatedReportIds !== undefined) row.consolidated_report_ids = data.consolidatedReportIds;
  if (data.observations !== undefined) row.observations = data.observations || null;
  if (data.shiftHandover !== undefined) row.shift_handover = data.shiftHandover || null;
  if (data.signatures !== undefined) row.signatures = data.signatures;
  if (data.status !== undefined) row.status = data.status;

  return row;
}

export async function createWorkWeeklyReport(data: WeeklyInput, ctx: Context): Promise<WorkWeeklyReport> {
  const { user, tenantId } = ctx;
  if (!user || !tenantId) throw new Error('No autenticado.');

  const today = new Date().toISOString().slice(0, 10);
  const baseRow = {
    tenant_id: tenantId,
    title: data.title || '',
    client: data.client || '',
    faena: data.faena || '',
    obra: data.obra || null,
    contract_number: data.contractNumber || null,
    area: data.area || null,
    specialty: data.specialty || null,
    supervisor_id: isUUID(data.supervisorId) ? data.supervisorId : user.id,
    supervisor_name: data.supervisorName || user.name,
    start_date: data.startDate || today,
    end_date: data.endDate || today,
    consolidated_report_ids: data.consolidatedReportIds || [],
    observations: data.observations || null,
    shift_handover: data.shiftHandover || null,
    signatures: data.signatures || [],
    status: data.status || 'draft',
    created_by: user.id,
    created_by_name: user.name,
    updated_by: user.id,
  };

  const { data: inserted, error } = await supabase
    .from('work_weekly_reports')
    .insert(baseRow)
    .select('*')
    .single();
  if (error) throw error;
  return mappers.work_weekly_reports(inserted);
}

export async function updateWorkWeeklyReport(id: string, data: WeeklyInput, ctx: Context): Promise<void> {
  const row = toRow(data, ctx);
  const { error } = await supabase.from('work_weekly_reports').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteWorkWeeklyReport(id: string, _ctx: Context): Promise<void> {
  const { error } = await supabase.from('work_weekly_reports').delete().eq('id', id);
  if (error) throw error;
}
