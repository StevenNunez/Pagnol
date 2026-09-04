import { supabase } from '@/modules/core/lib/supabase';
import { createDefaultHousekeeping } from '@/modules/core/lib/work-report-housekeeping';
import { mappers } from '../mappers';
import type {
  WorkReport,
  WorkReportPhoto,
  WorkReportSignature,
  WorkReportStatus,
} from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Puerta de permisos. El límite real lo pone la base (migración 20260902030000);
 * esto cubre el camino de la aplicación y da un mensaje entendible.
 *
 * `ctx.can` resuelve igual que la pantalla, incluidos los permisos que cada
 * empresa personalizó.
 */
function exigir(ctx: Context, permiso: Parameters<Context['can']>[0], accion: string) {
    if (!ctx.can(permiso)) throw new Error(`No tienes permiso para ${accion}.`);
}

const VALID_TRANSITIONS: Record<WorkReportStatus, WorkReportStatus[]> = {
  draft: ['pending_review'],
  pending_review: ['operations_approved', 'observed'],
  observed: ['pending_review'],
  operations_approved: ['final_approved', 'observed'],
  final_approved: ['archived'],
  archived: [],
};

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
  if (data.workItemId !== undefined) row.work_item_id = isUUID(data.workItemId) ? data.workItemId : null;
  if (data.otNumber !== undefined) row.ot_number = data.otNumber;
  if (data.client !== undefined) row.client = data.client;
  if (data.faena !== undefined) row.faena = data.faena;
  if (data.area !== undefined) row.area = data.area;
  if (data.supervisorId !== undefined) row.supervisor_id = isUUID(data.supervisorId) ? data.supervisorId : null;
  if (data.supervisorName !== undefined) row.supervisor_name = data.supervisorName;
  if (data.workDate !== undefined) row.work_date = data.workDate;
  if (data.startTime !== undefined) row.start_time = data.startTime || null;
  if (data.endTime !== undefined) row.end_time = data.endTime || null;
  if (data.location !== undefined) row.location = data.location || null;
  if (data.obra !== undefined) row.obra = data.obra || null;
  if (data.contractNumber !== undefined) row.contract_number = data.contractNumber || null;
  if (data.addendumNumber !== undefined) row.addendum_number = data.addendumNumber || null;
  if (data.shift !== undefined) row.shift = data.shift || null;
  if (data.specialty !== undefined) row.specialty = data.specialty || null;
  if (data.emittedBy !== undefined) row.emitted_by = data.emittedBy || null;
  if (data.emittedByRole !== undefined) row.emitted_by_role = data.emittedByRole || null;
  if (data.workSchedule !== undefined) row.work_schedule = data.workSchedule || null;
  if (data.dayNight !== undefined) row.day_night = data.dayNight || null;
  if (data.lunchStart !== undefined) row.lunch_start = data.lunchStart || null;
  if (data.restartTime !== undefined) row.restart_time = data.restartTime || null;
  if (data.activities !== undefined) row.activities = data.activities;
  if (data.structuredActivities !== undefined) row.structured_activities = data.structuredActivities;
  if (data.dailyOts !== undefined) row.daily_ots = data.dailyOts;
  if (data.consolidatedOrderIds !== undefined) row.consolidated_order_ids = data.consolidatedOrderIds;
  if (data.labor !== undefined) row.labor = data.labor;
  if (data.equipment !== undefined) row.equipment = data.equipment;
  if (data.interferences !== undefined) row.interferences = data.interferences;
  if (data.materials !== undefined) row.materials = data.materials;
  if (data.nextDayPlan !== undefined) row.next_day_plan = data.nextDayPlan;
  if (data.housekeeping !== undefined) row.housekeeping = data.housekeeping;
  if (data.photos !== undefined) row.photos = data.photos;
  if (data.progressPercent !== undefined) row.progress_percent = data.progressPercent;
  if (data.executionStatus !== undefined) row.execution_status = data.executionStatus;
  if (data.progressObservations !== undefined) row.progress_observations = data.progressObservations || null;
  if (data.progressHistory !== undefined) row.progress_history = data.progressHistory;
  if (data.signatures !== undefined) row.signatures = data.signatures;
  if (data.rejectionReason !== undefined) row.rejection_reason = data.rejectionReason || null;
  if (data.sentTo !== undefined) row.sent_to = data.sentTo || [];

  return row;
}

async function nextInternalCode(tenantId: string): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `IT-${year}-`;
  const { data, error } = await supabase
    .from('work_reports')
    .select('internal_code')
    .eq('tenant_id', tenantId)
    .like('internal_code', `${prefix}%`)
    .order('internal_code', { ascending: false })
    .limit(1);

  if (error) throw error;
  const last = data?.[0]?.internal_code as string | undefined;
  const seq = last ? parseInt(last.slice(prefix.length), 10) : 0;
  return `${prefix}${String(seq + 1).padStart(4, '0')}`;
}

export async function createWorkReport(
  data: WorkReportInput,
  ctx: Context
): Promise<WorkReport> {
  const { user, tenantId } = ctx;
  if (!user || !tenantId) throw new Error('No autenticado.');

  const firstAudit = audit('created', ctx, null, 'draft', 'Reporte creado como borrador.');
  const baseRow = {
    tenant_id: tenantId,
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
    structured_activities: data.structuredActivities || [],
    daily_ots: data.dailyOts || [],
    consolidated_order_ids: data.consolidatedOrderIds || [],
    labor: data.labor || [],
    equipment: data.equipment || [],
    interferences: data.interferences || [],
    materials: data.materials || [],
    next_day_plan: data.nextDayPlan || [],
    housekeeping: data.housekeeping || createDefaultHousekeeping(),
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
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    const internalCode = await nextInternalCode(tenantId);
    const { data: inserted, error } = await supabase
      .from('work_reports')
      .insert({ ...baseRow, internal_code: internalCode })
      .select()
      .single();

    if (!error) return mappers.work_reports(inserted);
    // 23505 = unique_violation — otro usuario tomó el mismo código; reintenta
    if ((error as any).code !== '23505') throw error;
  }
  throw new Error('No se pudo generar un código único. Intenta nuevamente.');
}

export async function updateWorkReport(
  id: string,
  data: WorkReportInput,
  ctx: Context
): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const row = toRow(data, ctx);
  // `.select()` para detectar el UPDATE silencioso de 0 filas: sin esto, un
  // cambio que la base rechaza se reporta como éxito en la pantalla.
  const { data: rows, error } = await supabase
    .from('work_reports')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .select('id');
  if (error) throw error;
  if (!rows || rows.length === 0) {
    throw new Error('No se pudo actualizar el informe: no existe o no tienes permiso para modificarlo.');
  }
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
    .select('status, signatures, audit_log, consolidated_order_ids')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  const fromStatus = current.status as WorkReportStatus;
  const isSuperAdmin = ctx.user.role === 'super-admin';
  if (!isSuperAdmin && !VALID_TRANSITIONS[fromStatus]?.includes(toStatus)) {
    throw new Error(`Transición no permitida: el reporte está en "${fromStatus}" y no puede pasar a "${toStatus}".`);
  }

  // Sólo se gatean las decisiones de REVISIÓN. Enviar a revisión y reenviar tras
  // una observación los hace quien redacta el informe, y no se tocan.
  if (toStatus === 'final_approved') {
    exigir(ctx, 'work_reports:final_approve', 'aprobar informes');
  } else if (toStatus === 'operations_approved') {
    if (!ctx.can('work_reports:review_operations') && !ctx.can('work_reports:final_approve')) {
      throw new Error('No tienes permiso para aprobar informes.');
    }
  } else if (toStatus === 'observed') {
    if (!ctx.can('work_reports:review_operations') && !ctx.can('work_reports:final_approve')) {
      throw new Error('No tienes permiso para devolver informes con observaciones.');
    }
  }
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
  // Reenvío tras observación: limpiar las aprobaciones parciales previas para
  // que Jefe de Operaciones y ADC vuelvan a revisar la versión corregida
  // (ver signWorkReportApproval — el modelo de aprobación es en paralelo).
  if (fromStatus === 'observed' && toStatus === 'pending_review') {
    row.operations_approved_at = null;
    row.final_approved_at = null;
  }
  if (details.sentTo) row.sent_to = details.sentTo;

  // Congela las OT consolidadas al (re)enviar a revisión: desde este punto el
  // Diario ya no debe cambiar si alguien edita la OT origen después (evita que
  // un documento firmado/aprobado se altere retroactivamente).
  if (toStatus === 'pending_review') {
    const orderIds: string[] = current.consolidated_order_ids || [];
    if (orderIds.length) {
      const { data: orderRows } = await supabase
        .from('work_orders')
        .select('*')
        .in('id', orderIds);
      row.consolidated_orders_snapshot = (orderRows || []).map((r) => mappers.work_orders(r));
    }
  }

  const { error } = await supabase
    .from('work_reports')
    .update(row)
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}

/**
 * Aprobación en paralelo: Jefe de Operaciones (`step: 'operations'`) y
 * Administrador de Contratos (`step: 'final'`) pueden firmar en cualquier
 * orden sobre el mismo informe en revisión. El informe pasa a
 * `final_approved` recién cuando AMBAS marcas de tiempo
 * (operations_approved_at / final_approved_at) están presentes; mientras
 * falte una, el status queda en `operations_approved` (que aquí significa
 * "1 de 2 firmas", sin importar cuál de los dos firmó primero).
 */
export async function signWorkReportApproval(
  id: string,
  step: 'operations' | 'final',
  details: { signature: WorkReportSignature; notes?: string },
  ctx: Context
): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const { data: current, error: readError } = await supabase
    .from('work_reports')
    .select('status, signatures, audit_log, operations_approved_at, final_approved_at')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  // Cada firma exige su propio permiso: son dos personas distintas por diseño.
  exigir(
    ctx,
    step === 'operations' ? 'work_reports:review_operations' : 'work_reports:final_approve',
    step === 'operations' ? 'firmar la revisión de operaciones' : 'firmar la aprobación final',
  );

  const fromStatus = current.status as WorkReportStatus;
  const isSuperAdmin = ctx.user.role === 'super-admin';
  if (!isSuperAdmin && fromStatus !== 'pending_review' && fromStatus !== 'operations_approved') {
    throw new Error('El informe no está disponible para aprobación en este momento.');
  }
  const alreadySigned = step === 'operations' ? !!current.operations_approved_at : !!current.final_approved_at;
  if (!isSuperAdmin && alreadySigned) {
    throw new Error('Ya registraste tu aprobación para este informe.');
  }

  const now = new Date().toISOString();
  const operationsApprovedAt = step === 'operations' ? now : current.operations_approved_at;
  const finalApprovedAt = step === 'final' ? now : current.final_approved_at;
  const bothApproved = !!operationsApprovedAt && !!finalApprovedAt;
  const toStatus: WorkReportStatus = bothApproved ? 'final_approved' : 'operations_approved';

  const row: Record<string, any> = {
    status: toStatus,
    updated_by: ctx.user.id,
    operations_approved_at: operationsApprovedAt,
    final_approved_at: finalApprovedAt,
    signatures: [...(current.signatures || []), details.signature],
    audit_log: [
      ...(current.audit_log || []),
      audit(step === 'operations' ? 'operations_approved' : 'final_approved', ctx, fromStatus, toStatus, details.notes),
    ],
  };

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

  // ~10 años en segundos; tiempo suficiente para informes de terreno de larga vida
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 315360000);
  if (signError) throw signError;
  return {
    id: photoId,
    url: signed.signedUrl,
    path,
    description,
    date: new Date().toISOString(),
    userId: ctx.user.id,
    userName: ctx.user.name,
  };
}

export async function deleteWorkReport(id: string, ctx: Context): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');
  const isSuperAdmin = ctx.user.role === 'super-admin';

  const { data: current, error: readError } = await supabase
    .from('work_reports')
    .select('photos, status')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  // Un Diario que ya salió de borrador/observado pasó por revisión y puede
  // tener firmas (Jefe de Operaciones / ADC) — protegido de borrado accidental.
  // Solo super-admin puede saltarse esto (mismo criterio que las transiciones
  // de estado en transitionWorkReport).
  if (!isSuperAdmin && current.status !== 'draft' && current.status !== 'observed') {
    throw new Error('Este informe ya fue enviado a revisión (o está aprobado) y no se puede eliminar — protege el historial de firmas/aprobaciones. Contacta a soporte si de verdad necesitas borrarlo.');
  }

  // Un Diario consolidado en un Reporte Semanal no se puede borrar sin antes
  // desvincularlo — evita que desaparezca en silencio del Semanal (mismo
  // patrón que el guard de OT→Diario en workOrderMutations.deleteWorkOrder).
  // El JSON va como STRING: supabase-js serializa un array de JavaScript como
  // array de Postgres (`{...}`), que sobre una columna jsonb revienta con
  // "invalid input syntax for type json". Y como el error se descartaba, la
  // guarda no bloqueaba nada: llevaba desde su creación dejando pasar todo.
  const { data: referencing, error: refError } = await supabase
    .from('work_weekly_reports')
    .select('title, status')
    .contains('consolidated_report_ids', JSON.stringify([id]))
    .limit(1);
  if (refError) throw refError;
  if (referencing && referencing.length > 0) {
    const r = referencing[0] as { title?: string; status?: string };
    throw new Error(`Este Diario está consolidado en el Reporte Semanal "${r.title || ''}" (${r.status || ''}). Quítalo de ahí antes de eliminarlo.`);
  }

  const photoPaths = ((current?.photos || []) as WorkReportPhoto[])
    .map((p) => p.path)
    .filter((p): p is string => !!p);
  if (photoPaths.length > 0) {
    await supabase.storage.from(BUCKET).remove(photoPaths);
  }

  const { error } = await supabase
    .from('work_reports')
    .delete()
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}

export async function deleteWorkReportPhoto(photo: WorkReportPhoto, ctx: Context): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');
  if (!photo.path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([photo.path]);
  if (error) throw error;
}

export async function recordWorkReportSent(
  id: string,
  recipients: string[],
  ctx: Context
): Promise<void> {
  if (!ctx.user || !ctx.tenantId) throw new Error('No autenticado.');

  const { data: current, error: readError } = await supabase
    .from('work_reports')
    .select('sent_to, audit_log')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .single();
  if (readError) throw readError;

  const existing: string[] = Array.isArray(current.sent_to) ? current.sent_to : [];
  const merged = Array.from(new Set([...existing, ...recipients]));

  const { error } = await supabase
    .from('work_reports')
    .update({
      sent_to: merged,
      updated_by: ctx.user.id,
      audit_log: [
        ...(current.audit_log || []),
        audit('sent', ctx, null, null, `Enviado a ${recipients.join(', ')}`),
      ],
    })
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId);
  if (error) throw error;
}
