import { supabase } from '@/modules/core/lib/supabase';
import { MaintenanceOrder, MaintenanceLog } from '@/modules/core/lib/data';

type Context = { user: any; tenantId: string | null; db?: any };

const generateOTCode = async (tenantId: string): Promise<string> => {
    const { count } = await supabase
        .from('maintenance_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
    const prefix = tenantId.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || 'OT';
    return `OT-${prefix}-${String((count || 0) + 1).padStart(4, '0')}`;
};

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
    const { error } = await supabase.from('maintenance_orders').update(payload).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw new Error(`Error al actualizar OT: ${error.message}`);
};

export const closeMaintenanceOrder = async (
    id: string,
    data: Partial<MaintenanceOrder>,
    { user, tenantId }: Context
) => {
    if (!user || !tenantId) throw new Error('No autenticado.');
    const { error } = await supabase.from('maintenance_orders').update({
        status: 'COMPLETED',
        completed_at: new Date().toISOString(),
        root_cause_analysis: data.rootCauseAnalysis || null,
        preventive_action: data.preventiveAction || null,
        downtime_hours: data.downtimeHours || null,
    }).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw new Error(`Error al cerrar OT: ${error.message}`);
};

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
