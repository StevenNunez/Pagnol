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
  if (data.consolidatedReportsSnapshot !== undefined) row.consolidated_reports_snapshot = data.consolidatedReportsSnapshot;
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
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');
  const row = toRow(data, ctx);
  // RLS que no matchea ninguna fila NO lanza error (solo actualiza 0 filas) —
  // .select() + verificar filas es la única forma de detectarlo.
  const { data: updated, error } = await supabase
    .from('work_weekly_reports')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('id');
  if (error) throw error;
  if (!updated || updated.length === 0) {
    throw new Error('No se pudo guardar el reporte semanal: sin permisos sobre este registro o ya no existe.');
  }
}

export async function deleteWorkWeeklyReport(id: string, ctx: Context): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');
  const isSuperAdmin = ctx.user.role === 'super-admin';

  const { data: current, error: readError } = await supabase
    .from('work_weekly_reports')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  // Un Semanal 'ready' ya fue firmado por el supervisor (y puede tener la
  // aprobación de Jefe de Operaciones) — protegido de borrado accidental,
  // igual que un Diario fuera de borrador/observado. Solo super-admin puede
  // saltarse esto.
  if (!isSuperAdmin && current.status !== 'draft') {
    throw new Error('Este reporte semanal ya fue firmado y no se puede eliminar — protege el historial de firmas. Contacta a soporte si de verdad necesitas borrarlo.');
  }

  const { error } = await supabase
    .from('work_weekly_reports')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}
