import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { MaintenanceOrder, MaintenanceLog } from '@/modules/core/lib/data';
import { assetStatusAfterOrders } from './maintenanceMath';

import type { MutationContext as Context } from './context';

// El código de una OT sale del contador de la empresa (como el de los demás documentos). Antes era
// «cuántas OT hay + 1»: dos OT creadas a la vez, o una borrada, repetían el número.
const generateOTCode = (tenantId: string) => nextInternalCode(tenantId, 'MNT');

/**
 * Alinea el estado del activo con sus órdenes de trabajo: una OT que lo retiene lo pasa a
 * «En Mantenimiento» y, cuando ya no hay ninguna, vuelve a «Disponible» o «En Uso» (ver
 * `maintenanceMath.ts`). Es un efecto de la OT, no su razón de ser: si falla, la OT ya quedó guardada y
 * sólo se deja constancia en el registro del servidor.
 */
export async function syncAssetStatus(tenantId: string, materialId: string): Promise<void> {
    try {
        const [{ data: orders, error: oErr }, { data: mat, error: mErr }] = await Promise.all([
            supabase.from('maintenance_orders').select('status, type').eq('tenant_id', tenantId).eq('material_id', materialId),
            supabase.from('materials').select('id, status, in_use, usage_type').eq('id', materialId).eq('tenant_id', tenantId).maybeSingle(),
        ]);
        if (oErr) throw oErr;
        if (mErr) throw mErr;
        if (!mat) return;
        const next = assetStatusAfterOrders({ status: mat.status, inUse: Number(mat.in_use) || 0, usageType: mat.usage_type }, orders || []);
        if (!next) return;
        // Sólo si nadie lo cambió en el medio; si cambió, esa persona ya decidió su estado.
        const { error } = await supabase.from('materials').update({ status: next })
            .eq('id', mat.id).eq('tenant_id', tenantId).eq('status', mat.status).select('id');
        if (error) throw error;
    } catch (e) {
        console.error('[mantenimiento] no se pudo alinear el estado del activo con sus OT', materialId, e);
    }
}

export const addMaintenanceOrder = async (
    data: Omit<MaintenanceOrder, 'id' | 'tenantId' | 'createdAt'>,
    { user, tenantId }: Context
) => {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    const internalCode = await generateOTCode(tenantId);
    const { error } = await supabase.from('maintenance_orders').insert({
        internal_code: internalCode,
        tenant_id: tenantId,
        material_id: data.materialId,
        material_name: data.materialName,
        type: data.type,
        status: data.status || 'OPEN',
        priority: data.priority,
        scheduled_date: data.scheduledDate || null,
        reported_by: data.reportedBy || user.name,
        assigned_to: data.assignedTo || null,
        assigned_to_name: data.assignedToName || null,
        description: data.description,
        root_cause_analysis: data.rootCauseAnalysis || null,
        preventive_action: data.preventiveAction || null,
        parts_used: data.partsUsed || [],
        downtime_hours: data.downtimeHours || null,
        total_cost: data.totalCost || null,
    });
    if (error) throw new Error(`Error al crear OT: ${error.message}`);
    await syncAssetStatus(tenantId, data.materialId);
};

export const updateMaintenanceOrder = async (
    id: string,
    data: Partial<MaintenanceOrder>,
    { tenantId }: Context
) => {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const payload: any = {};
    if (data.status !== undefined) payload.status = data.status;
    if (data.priority !== undefined) payload.priority = data.priority;
    if (data.assignedTo !== undefined) payload.assigned_to = data.assignedTo;
    if (data.assignedToName !== undefined) payload.assigned_to_name = data.assignedToName;
    if (data.scheduledDate !== undefined) payload.scheduled_date = data.scheduledDate;
    if (data.description !== undefined) payload.description = data.description;
    if (data.rootCauseAnalysis !== undefined) payload.root_cause_analysis = data.rootCauseAnalysis;
    if (data.preventiveAction !== undefined) payload.preventive_action = data.preventiveAction;
    if (data.partsUsed !== undefined) payload.parts_used = data.partsUsed;
    if (data.downtimeHours !== undefined) payload.downtime_hours = data.downtimeHours;
    if (data.totalCost !== undefined) payload.total_cost = data.totalCost;
    // `.select()`: un UPDATE que la RLS deja en 0 filas no lanza error y antes «se guardaba» sin guardar.
    const { data: rows, error } = await supabase.from('maintenance_orders').update(payload).eq('id', id).eq('tenant_id', tenantId).select('id, material_id');
    if (error) throw new Error(`Error al actualizar OT: ${error.message}`);
    if (!rows?.length) throw new Error('No se encontró la orden de trabajo.');
    if (data.status !== undefined) await syncAssetStatus(tenantId, rows[0].material_id);
};

export const closeMaintenanceOrder = async (
    id: string,
    data: Partial<MaintenanceOrder>,
    { user, tenantId }: Context
) => {
    if (!user || !tenantId) throw new Error('No autenticado.');
    // Sólo se cierra lo que sigue abierto: cerrar dos veces no pisa la fecha ni el análisis del primer cierre.
    const { data: rows, error } = await supabase.from('maintenance_orders').update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        root_cause_analysis: data.rootCauseAnalysis || null,
        preventive_action: data.preventiveAction || null,
        downtime_hours: data.downtimeHours || null,
    }).eq('id', id).eq('tenant_id', tenantId).in('status', ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS']).select('id, material_id');
    if (error) throw new Error(`Error al cerrar OT: ${error.message}`);
    if (!rows?.length) throw new Error('Esta orden ya estaba cerrada o no existe.');
    // El equipo sale de «En Mantenimiento» al cerrar su última OT.
    await syncAssetStatus(tenantId, rows[0].material_id);
};

/**
 * Abre la OT correctiva de un equipo que volvió con falla. Antes la devolución sólo marcaba el equipo
 * «En Mantenimiento» y nadie quedaba con la tarea de arreglarlo. Si ya hay una correctiva abierta de ese
 * equipo no abre otra (una falla, una OT). Devuelve el código de la OT, o null si ya había una.
 */
export async function openCorrectiveOrderForReturn(
    p: {
        tenantId: string;
        materialId: string;
        materialName: string;
        description: string;
        priority: MaintenanceOrder['priority'];
        reportedBy: string;
    },
): Promise<string | null> {
    const { data: open } = await supabase.from('maintenance_orders').select('id')
        .eq('tenant_id', p.tenantId).eq('material_id', p.materialId).eq('type', 'CORRECTIVE').in('status', ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS']);
    if (open?.length) return null;
    const internalCode = await generateOTCode(p.tenantId);
    const { error } = await supabase.from('maintenance_orders').insert({
        internal_code: internalCode,
        tenant_id: p.tenantId,
        material_id: p.materialId,
        material_name: p.materialName,
        type: 'CORRECTIVE',
        status: 'OPEN',
        priority: p.priority,
        reported_by: p.reportedBy,
        description: p.description,
        parts_used: [],
    });
    if (error) throw new Error(`Error al crear OT: ${error.message}`);
    await syncAssetStatus(p.tenantId, p.materialId);
    return internalCode;
}

export const addMaintenanceLog = async (
    data: Omit<MaintenanceLog, 'id' | 'tenantId'>,
    { tenantId }: Context
) => {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase.from('maintenance_logs').insert({
        tenant_id: tenantId,
        material_id: data.materialId,
        order_id: data.orderId || null,
        timestamp: data.timestamp || new Date().toISOString(),
        action: data.action,
        performed_by: data.performedBy,
        performed_by_name: data.performedByName,
        type: data.type,
    });
    if (error) throw new Error(`Error al registrar log: ${error.message}`);
};
