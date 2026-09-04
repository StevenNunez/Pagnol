import { supabase } from '@/modules/core/lib/supabase';
import { Protocol, ProtocolTemplate, ProtocolSignature } from '@/modules/core/lib/data';

import type { MutationContext as Context } from './context';

/**
 * Verifica que el UPDATE haya tocado al menos una fila.
 *
 * Un UPDATE que RLS deja en 0 filas **no devuelve error**: Supabase responde
 * éxito con una lista vacía. Sin esta guarda, la pantalla decía "Protocolo
 * aprobado" y en la base no cambiaba nada.
 */
/**
 * Puerta de permisos. `can` viene en el contexto y resuelve igual que la
 * pantalla; cada acción exige exactamente el permiso con el que la pantalla
 * muestra su botón, ni uno más estricto.
 */
function exigir(can: Context['can'], permiso: Parameters<Context['can']>[0], accion: string) {
    if (!can(permiso)) throw new Error(`No tienes permiso para ${accion}.`);
}

function assertTocado(rows: { id: string }[] | null, accion: string) {
    if (!rows || rows.length === 0) {
        throw new Error(`No se pudo ${accion}: el protocolo no existe o no tienes permiso para modificarlo.`);
    }
}

export async function addProtocolTemplate(
    data: Omit<ProtocolTemplate, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>,
    { user, tenantId, can }: Context
) {
    if (!user || !tenantId) throw new Error('No autenticado.');
    exigir(can, 'construction_control:review_protocols', 'crear plantillas de protocolo');
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

export async function deleteProtocolTemplate(templateId: string, { can }: Context) {
    exigir(can, 'construction_control:review_protocols', 'eliminar plantillas de protocolo');
    const { error } = await supabase.from('protocol_templates').delete().eq('id', templateId);
    if (error) throw error;
}

export async function createProtocol(
    data: Omit<Protocol, 'id' | 'tenantId' | 'createdBy' | 'createdAt' | 'status' | 'evidencePhotos' | 'executorSignature' | 'supervisorSignature' | 'qualityManagerSignature' | 'completedAt' | 'reviewedAt'>,
    { user, tenantId, can }: Context
): Promise<string> {
    if (!user || !tenantId) throw new Error('No autenticado.');
    exigir(can, 'module_construction_control:view', 'crear protocolos');
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
    { can }: Context
) {
    exigir(can, 'module_construction_control:view', 'editar protocolos');
    const { data: rows, error } = await supabase.from('protocols').update({
        items: data.items,
        evidence_photos: data.evidencePhotos,
        executor_signature: data.executorSignature ?? null,
    }).eq('id', protocolId).select('id');
    if (error) throw error;
    assertTocado(rows, 'guardar el borrador');
}

export async function submitProtocolForReview(
    protocolId: string,
    data: { items: Protocol['items']; evidencePhotos: string[]; executorSignature: ProtocolSignature; supervisorSignature?: ProtocolSignature | null },
    { can }: Context
) {
    exigir(can, 'module_construction_control:view', 'enviar protocolos a revisión');
    const { data: rows, error } = await supabase.from('protocols').update({
        items: data.items,
        evidence_photos: data.evidencePhotos,
        executor_signature: data.executorSignature,
        supervisor_signature: data.supervisorSignature ?? null,
        status: 'pendiente_revision',
        completed_at: new Date().toISOString(),
    }).eq('id', protocolId).select('id');
    if (error) throw error;
    assertTocado(rows, 'enviar el protocolo a revisión');
}

export async function approveProtocol(
    protocolId: string,
    signature: ProtocolSignature,
    { can }: Context
) {
    exigir(can, 'construction_control:review_protocols', 'aprobar protocolos');
    const { data: rows, error } = await supabase.from('protocols').update({
        status: 'aprobado',
        quality_manager_signature: signature,
        reviewed_at: new Date().toISOString(),
        rejection_reason: null,
    }).eq('id', protocolId).select('id');
    if (error) throw error;
    assertTocado(rows, 'aprobar el protocolo');
}

export async function rejectProtocol(
    protocolId: string,
    reason: string,
    signature: ProtocolSignature,
    { can }: Context
) {
    exigir(can, 'construction_control:review_protocols', 'rechazar protocolos');
    const { data: rows, error } = await supabase.from('protocols').update({
        status: 'rechazado',
        quality_manager_signature: signature,
        rejection_reason: reason,
        reviewed_at: new Date().toISOString(),
    }).eq('id', protocolId).select('id');
    if (error) throw error;
    assertTocado(rows, 'rechazar el protocolo');
}

export async function deleteProtocol(protocolId: string, { can }: Context) {
    exigir(can, 'module_construction_control:view', 'eliminar protocolos');

    // Solo borradores. Un protocolo enviado, aprobado o rechazado ya está
    // firmado: es el registro de que la revisión de calidad ocurrió, y borrarlo
    // deja la partida aprobada sin su respaldo. La pantalla solo ofrece el botón
    // en borradores; esto lo vuelve una regla y no una omisión de la vista.
    const { data: actual } = await supabase
        .from('protocols').select('status').eq('id', protocolId).maybeSingle();
    if (actual && actual.status !== 'borrador') {
        throw new Error('Solo se pueden eliminar protocolos en borrador: los enviados o revisados son el registro firmado de la revisión de calidad.');
    }

    const { error } = await supabase.from('protocols').delete().eq('id', protocolId);
    if (error) throw error;
}
