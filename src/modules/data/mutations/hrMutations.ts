import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import type { LeaveRequest, LeaveStatus, HRDocument } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

const BUCKET = 'hr-documents';

function makeId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// ── Vacaciones / Licencias ───────────────────────────────────────────────────

export async function addLeaveRequest(
  data: Omit<LeaveRequest, 'id' | 'tenantId' | 'userId' | 'userName' | 'status' | 'createdAt' | 'reviewedBy' | 'reviewedByName' | 'reviewedAt' | 'rejectionReason'>,
  { user, tenantId }: Context
): Promise<LeaveRequest> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('hr_leave_requests')
    .insert({
      tenant_id: tenantId,
      user_id: user.id,
      user_name: user.name,
      type: data.type,
      start_date: data.startDate,
      end_date: data.endDate,
      days_count: data.daysCount,
      reason: data.reason || null,
      supporting_document_url: data.supportingDocumentUrl || null,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.hr_leave_requests(inserted);
}

export async function updateLeaveRequestStatus(
  id: string,
  status: LeaveStatus,
  details: { rejectionReason?: string } | undefined,
  { user, tenantId }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('hr_leave_requests')
    .update({
      status,
      reviewed_by: user.id,
      reviewed_by_name: user.name,
      reviewed_at: new Date().toISOString(),
      rejection_reason: status === 'rejected' ? (details?.rejectionReason || null) : null,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteLeaveRequest(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('hr_leave_requests')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Documentos de empleados ───────────────────────────────────────────────────

export async function addHRDocument(
  data: Omit<HRDocument, 'id' | 'tenantId' | 'fileUrl' | 'filePath' | 'createdBy' | 'createdAt'>,
  file: File | null,
  { user, tenantId }: Context
): Promise<HRDocument> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  let filePath: string | null = null;

  if (file) {
    const ext = file.name.split('.').pop() || 'pdf';
    const docId = makeId();
    filePath = `${tenantId}/${data.userId}/${docId}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
  }

  // Se guarda el PATH y NUNCA una URL firmada.
  //
  // Antes aquí se firmaba por 315.360.000 s (~10 años) y esa URL quedaba escrita
  // en la fila. Una URL firmada es una **llave al portador**: quien la ve abre el
  // archivo sin sesión, sin pertenecer al tenant y sin que haya forma de
  // revocarla — durante diez años, sobre documentos laborales con datos
  // personales. Y la fila viaja a cualquiera que pueda leer `hr_documents`.
  //
  // Ahora se firma en el momento del clic (`<SecureFileLink>`), con 5 minutos de
  // vida. Las filas antiguas conservan su URL y siguen abriéndose: el firmador
  // extrae el path desde la propia URL, así que no hay que migrar datos.
  const fileUrl: string | null = null;

  const { data: inserted, error } = await supabase
    .from('hr_documents')
    .insert({
      tenant_id: tenantId,
      user_id: data.userId,
      user_name: data.userName || '',
      document_type: data.documentType,
      name: data.name,
      file_url: fileUrl,
      file_path: filePath,
      issue_date: data.issueDate || null,
      expiry_date: data.expiryDate || null,
      notes: data.notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.hr_documents(inserted);
}

export async function updateHRDocument(
  id: string,
  data: Partial<HRDocument>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.documentType !== undefined) payload.document_type = data.documentType;
  if (data.name !== undefined) payload.name = data.name;
  if (data.issueDate !== undefined) payload.issue_date = data.issueDate;
  if (data.expiryDate !== undefined) payload.expiry_date = data.expiryDate;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('hr_documents')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteHRDocument(doc: HRDocument, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  if (doc.filePath) {
    await supabase.storage.from(BUCKET).remove([doc.filePath]);
  }

  const { error } = await supabase
    .from('hr_documents')
    .delete()
    .eq('id', doc.id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}
