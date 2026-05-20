import { supabase } from '@/modules/core/lib/supabase';
import { Protocol, ProtocolTemplate, ProtocolSignature } from '@/modules/core/lib/data';

interface Context { user: any; tenantId: string | null; }

export async function addProtocolTemplate(
    data: Omit<ProtocolTemplate, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>,
    { user, tenantId }: Context
) {
    if (!user || !tenantId) throw new Error('No autenticado.');
    const { error } = await supabase.from('protocol_templates').insert({
        tenant_id: tenantId,
        title: data.title,
        type: data.type,
        activity_type: data.activityType,
        objective: data.objective,
        normativa: data.normativa,
        responsibilities: data.responsibilities,
        items: data.items,
        created_by: user.id,
    });
    if (error) throw error;
}

export async function deleteProtocolTemplate(templateId: string, { }: Context) {
    const { error } = await supabase.from('protocol_templates').delete().eq('id', templateId);
    if (error) throw error;
}

export async function createProtocol(
    data: Omit<Protocol, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'status' | 'evidencePhotos' | 'executorSignature' | 'supervisorSignature' | 'qualityManagerSignature' | 'completedAt' | 'reviewedAt'>,
    { user, tenantId }: Context
): Promise<string> {
    if (!user || !tenantId) throw new Error('No autenticado.');
    const { data: row, error } = await supabase.from('protocols').insert({
        tenant_id: tenantId,
        template_id: data.templateId ?? null,
        work_item_id: data.workItemId ?? null,
        title: data.title,
        type: data.type,
        activity_type: data.activityType,
        obra: data.obra,
        objective: data.objective,
        normativa: data.normativa,
        responsibilities: data.responsibilities,
        items: data.items,
        status: 'borrador',
        evidence_photos: [],
        created_by: user.id,
    }).select('id').single();
    if (error) throw error;
    return row.id;
}

export async function saveProtocolDraft(
    protocolId: string,
    data: { items: Protocol['items']; evidencePhotos: string[]; executorSignature?: ProtocolSignature | null },
    { }: Context
) {
    const { error } = await supabase.from('protocols').update({
        items: data.items,
        evidence_photos: data.evidencePhotos,
        executor_signature: data.executorSignature ?? null,
    }).eq('id', protocolId);
    if (error) throw error;
}

export async function submitProtocolForReview(
    protocolId: string,
    data: { items: Protocol['items']; evidencePhotos: string[]; executorSignature: ProtocolSignature; supervisorSignature?: ProtocolSignature | null },
    { }: Context
) {
    const { error } = await supabase.from('protocols').update({
        items: data.items,
        evidence_photos: data.evidencePhotos,
        executor_signature: data.executorSignature,
        supervisor_signature: data.supervisorSignature ?? null,
        status: 'pendiente_revision',
        completed_at: new Date().toISOString(),
    }).eq('id', protocolId);
    if (error) throw error;
}

export async function approveProtocol(
    protocolId: string,
    signature: ProtocolSignature,
    { }: Context
) {
    const { error } = await supabase.from('protocols').update({
        status: 'aprobado',
        quality_manager_signature: signature,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null,
    }).eq('id', protocolId);
    if (error) throw error;
}

export async function rejectProtocol(
    protocolId: string,
    reason: string,
    signature: ProtocolSignature,
    { }: Context
) {
    const { error } = await supabase.from('protocols').update({
        status: 'rechazado',
        quality_manager_signature: signature,
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
    }).eq('id', protocolId);
    if (error) throw error;
}

export async function deleteProtocol(protocolId: string, { }: Context) {
    const { error } = await supabase.from('protocols').delete().eq('id', protocolId);
    if (error) throw error;
}
