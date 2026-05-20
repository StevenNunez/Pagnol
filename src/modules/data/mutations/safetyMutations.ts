

import { supabase } from '@/modules/core/lib/supabase';
import { AssignedSafetyTask, ChecklistTemplate, DailyTalk, User } from '../../core/lib/data';

type Context = {
    user: any;
    tenantId: string | null;
    db: any;
};

export async function addChecklistTemplate(template: Pick<ChecklistTemplate, 'title' | 'items'>, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('checklist_templates').insert({
        title: template.title,
        items: template.items,
        created_by: user.id,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
    });

    if (error) throw error;
}

export async function deleteChecklistTemplate(templateId: string, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { error } = await supabase.from('checklist_templates').delete().eq('id', templateId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function assignChecklistToSupervisors(template: ChecklistTemplate, supervisorIds: string[], workArea: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    for (const supervisorId of supervisorIds) {
        await supabase.from('assigned_checklists').insert({
            template_id: template.id,
            template_title: template.title,
            supervisor_id: supervisorId,
            assigner_id: user.id,
            assigner_name: user.name,
            status: 'assigned',
            area: workArea,
            items: template.items,
            tenant_id: tenantId,
            created_at: new Date().toISOString(),
        });
    }
}

export async function completeAssignedChecklist(checklist: AssignedSafetyTask, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");

    const { error } = await supabase.from('assigned_checklists').update({
        items: checklist.items,
        status: 'completed',
        completed_at: new Date().toISOString(),
    }).eq('id', checklist.id).eq('tenant_id', tenantId);

    if (error) throw error;
}

export async function reviewAssignedChecklist(checklistId: string, status: 'approved' | 'rejected', notes: string, signature: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

    const { error } = await supabase.from('assigned_checklists').update({
        status,
        rejection_notes: status === 'rejected' ? notes : null,
        reviewed_by: {
            id: user.id,
            name: user.name,
            signature,
            date: new Date().toISOString()
        }
    }).eq('id', checklistId).eq('tenant_id', tenantId);

    if (error) throw error;
}

export async function deleteAssignedChecklist(checklistId: string, { tenantId }: Context) {
    if (!tenantId) throw new Error("Inquilino no válido.");
    const { error } = await supabase.from('assigned_checklists').delete().eq('id', checklistId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function addSafetyInspection(data: any, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('safety_inspections').insert({
        area: data.area ?? data.work,
        location: data.location,
        description: data.description,
        risk_level: data.riskLevel,
        action_plan: data.actionPlan,
        evidence_photo_url: data.evidencePhotoUrl,
        evidence_photos: data.evidencePhotos ?? [],
        assigned_to: data.assignedTo,
        deadline: data.deadline,
        inspector_id: data.inspectorId ?? user.id,
        inspector_name: data.inspectorName ?? user.name,
        inspector_role: data.inspectorRole ?? user.role,
        date: new Date().toISOString(),
        status: 'open',
        tenant_id: tenantId,
    });
    if (error) throw error;
}

export async function completeSafetyInspection(inspectionId: string, data: any, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('safety_inspections').update({
        ...data,
        status: 'completed',
        completed_at: new Date().toISOString(),
        completion_executor: user.name,
    }).eq('id', inspectionId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function reviewSafetyInspection(inspectionId: string, status: 'approved' | 'rejected', notes: string, signature: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('safety_inspections').update({
        status,
        rejection_notes: status === 'rejected' ? notes : null,
        reviewed_by: {
            id: user.id,
            name: user.name,
            signature,
            date: new Date().toISOString(),
        },
    }).eq('id', inspectionId).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function addBehaviorObservation(data: any, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('behavior_observations').insert({
        obra: data.obra,
        worker_id: data.workerId,
        worker_name: data.workerName,
        worker_rut: data.workerRut,
        observation_date: data.observationDate instanceof Date ? data.observationDate.toISOString() : data.observationDate,
        items: data.items,
        risk_level: data.riskLevel,
        feedback: data.feedback,
        observer_signature: data.observerSignature,
        worker_signature: data.workerSignature,
        evidence_photo: data.evidencePhoto,
        observer_id: data.observerId ?? user.id,
        observer_name: data.observerName ?? user.name,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
    });
    if (error) throw error;
}

export async function addDailyTalk(data: Omit<DailyTalk, 'id' | 'createdAt' | 'tenantId'>, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    const { error } = await supabase.from('daily_talks').insert({
        obra: data.obra,
        fecha: data.fecha,
        asistentes: data.asistentes,
        temas: data.temas,
        firma: data.firma,
        foto: data.foto || null,
        expositor_id: data.expositorId,
        expositor_name: data.expositorName,
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
    });
    if (error) throw error;
}

export async function signDailyTalk(talkId: string, { user, tenantId }: Context) {
    if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

    const { data: talk } = await supabase.from('daily_talks').select('*').eq('id', talkId).single();
    if (!talk) throw new Error("La charla no existe.");

    const { data: userProfile } = await supabase.from('profiles').select('signature').eq('id', user.id).single();
    if (!userProfile) throw new Error("No se pudo encontrar tu perfil de usuario.");

    const attendees = talk.asistentes || [];
    const attendeeIndex = attendees.findIndex((a: any) => a.id === user.id);

    if (attendeeIndex === -1) {
        throw new Error("No estás en la lista de asistentes de esta charla.");
    }

    const newAttendees = [...attendees];
    newAttendees[attendeeIndex] = {
        ...newAttendees[attendeeIndex],
        signed: true,
        signedAt: new Date().toISOString(),
        signature: userProfile.signature || null,
    };

    const { error } = await supabase.from('daily_talks').update({ asistentes: newAttendees }).eq('id', talkId);
    if (error) throw error;
}


