import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type {
  WorkReport,
  WorkReportPhoto,
  WorkReportSignature,
  WorkReportStatus,
} from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

type WorkReportInput = Partial<Omit<WorkReport, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>;

const BUCKET = 'work-report-photos';

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function audit(action: string, ctx: Context, fromStatus?: WorkReportStatus | null, toStatus?: WorkReportStatus | null, notes?: string) {
  return {
    id: makeId(),
    action,
    fromStatus: fromStatus ?? null,
    toStatus: toStatus ?? null,
    userId: ctx.user?.id || '',
    userName: ctx.user?.name || 'Usuario',
    date: new Date().toISOString(),
    notes,
  };
}

function toRow(data: WorkReportInput, ctx: Context): Record<string, any> {
  const row: Record<string, any> = { updated_by: ctx.user?.id || null };

  if (data.status !== undefined) row.status = data.status;
  if (data.workItemId !== undefined) row.work_item_id = data.workItemId || null;
  if (data.otNumber !== undefined) row.ot_number = data.otNumber;
  if (data.client !== undefined) row.client = data.client;
  if (data.faena !== undefined) row.faena = data.faena;
  if (data.area !== undefined) row.area = data.area;
  if (data.supervisorId !== undefined) row.supervisor_id = data.supervisorId || null;
  if (data.supervisorName !== undefined) row.supervisor_name = data.supervisorName;
  if (data.workDate !== undefined) row.work_date = data.workDate;
  if (data.startTime !== undefined) row.start_time = data.startTime || null;
  if (data.endTime !== undefined) row.end_time = data.endTime || null;
  if (data.location !== undefined) row.location = data.location || null;
  if (data.activities !== undefined) row.activities = data.activities;
  if (data.labor !== undefined) row.labor = data.labor;
  if (data.equipment !== undefined) row.equipment = data.equipment;
  if (data.materials !== undefined) row.materials = data.materials;
  if (data.photos !== undefined) row.photos = data.photos;
  if (data.progressPercent !== undefined) row.progress_percent = data.progressPercent;
  if (data.executionStatus !== undefined) row.execution_status = data.executionStatus;
  if (data.progressObservations !== undefined) row.progress_observations = data.progressObservations || null;
  if (data.progressHistory !== undefined) row.progress_history = data.progressHistory;
  if (data.signatures !== undefined) row.signatures = data.signatures;
  if (data.auditLog !== undefined) row.audit_log = data.auditLog;
  if (data.rejectionReason !== undefined) row.rejection_reason = data.rejectionReason || null;
  if (data.sentTo !== undefined) row.sent_to = data.sentTo || [];

  return row;
}

async function nextInternalCode(tenantId: string) {
  const year = new Date().getFullYear();
  const prefix = `IT-${year}-`;
  const { count, error } = await supabase
    .from('work_reports')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', `${year}-01-01T00:00:00.000Z`);

  if (error) throw error;
  return `${prefix}${String((count || 0) + 1).padStart(4, '0')}`;
}

export async function createWorkReport(
  data: WorkReportInput,
  ctx: Context
): Promise<WorkReport> {
  const { user, tenantId } = ctx;
  if (!user || !tenantId) throw new Error('No autenticado.');

  const internalCode = await nextInternalCode(tenantId);
  const firstAudit = audit('created', ctx, null, 'draft', 'Reporte creado como borrador.');

  const { data: inserted, error } = await supabase
    .from('work_reports')
    .insert({
      tenant_id: tenantId,
      internal_code: internalCode,
      status: 'draft',
      work_item_id: data.workItemId || null,
      ot_number: data.otNumber || '',
      client: data.client || '',
      faena: data.faena || '',
      area: data.area || '',
      supervisor_id: data.supervisorId || user.id,
      supervisor_name: data.supervisorName || user.name,
      work_date: data.workDate || new Date().toISOString().slice(0, 10),
      start_time: data.startTime || null,
      end_time: data.endTime || null,
      location: data.location || null,
      activities: data.activities || '',
      labor: data.labor || [],
      equipment: data.equipment || [],
      materials: data.materials || [],
      photos: data.photos || [],
      progress_percent: data.progressPercent || 0,
      execution_status: data.executionStatus || 'not_started',
      progress_observations: data.progressObservations || null,
      progress_history: data.progressHistory || [],
      signatures: data.signatures || [],
      audit_log: [firstAudit],
      created_by: user.id,
      created_by_name: user.name,
      updated_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.work_reports(inserted);
}

export async function updateWorkReport(
  id: string,
  data: WorkReportInput,
  ctx: Context
): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const row = toRow(data, ctx);
  const { data: current, error: readError } = await supabase
    .from('work_reports')
    .select('audit_log')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  row.audit_log = [
    ...(current?.audit_log || []),
    audit('updated', ctx, undefined, undefined, 'Borrador actualizado.'),
  ];

  const { error } = await supabase
    .from('work_reports')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}

export async function transitionWorkReport(
  id: string,
  toStatus: WorkReportStatus,
  details: { signature?: WorkReportSignature; notes?: string; sentTo?: string[] } = {},
  ctx: Context
): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const { data: current, error: readError } = await supabase
    .from('work_reports')
    .select('status, signatures, audit_log')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  const fromStatus = current.status as WorkReportStatus;
  const now = new Date().toISOString();
  const row: Record<string, any> = {
    status: toStatus,
    updated_by: ctx.user.id,
    signatures: details.signature
      ? [...(current.signatures || []), details.signature]
      : (current.signatures || []),
    audit_log: [
      ...(current.audit_log || []),
      audit('status_changed', ctx, fromStatus, toStatus, details.notes),
    ],
  };

  if (toStatus === 'pending_review') row.submitted_at = now;
  if (toStatus === 'operations_approved') row.operations_approved_at = now;
  if (toStatus === 'final_approved') row.final_approved_at = now;
  if (toStatus === 'observed') row.rejection_reason = details.notes || null;
  if (details.sentTo) row.sent_to = details.sentTo;

  const { error } = await supabase
    .from('work_reports')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}

export async function uploadWorkReportPhoto(
  reportId: string,
  file: File,
  description: string,
  ctx: Context
): Promise<WorkReportPhoto> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const ext = file.name.split('.').pop() || 'jpg';
  const photoId = makeId();
  const path = `${ctx.tenantId}/${reportId}/${photoId}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    id: photoId,
    url: data.publicUrl,
    path,
    description,
    date: new Date().toISOString(),
    userId: ctx.user.id,
    userName: ctx.user.name,
  };
}

export async function deleteWorkReportPhoto(photo: WorkReportPhoto, ctx: Context): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');
  if (!photo.path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([photo.path]);
  if (error) throw error;
}
