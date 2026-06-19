import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import type { CostCenter } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

export async function addCostCenter(
    data: Partial<Omit<CostCenter, 'id' | 'createdAt' | 'tenantId'>>,
    { user, tenantId }: Context,
) {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!data.name?.trim()) throw new Error('El nombre del centro de costo es requerido.');

    const code = data.code?.trim() || (await nextInternalCode(tenantId, 'CC'));
    const { error } = await supabase.from('cost_centers').insert({
        code,
        name: data.name.trim(),
        type: data.type || 'Operaciones',
        budget: data.budget ?? 0,
        status: data.status || 'active',
        responsible_id: data.responsibleId || null,
        responsible_name: data.responsibleName || null,
        start_date: data.startDate || null,
        end_date: data.endDate || null,
        notes: data.notes || null,
        created_by: user.id,
        tenant_id: tenantId,
    });
    if (error) throw error;
}

export async function updateCostCenter(id: string, data: Partial<CostCenter>, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const row: any = {};
    if ('code' in data) row.code = data.code;
    if ('name' in data) row.name = data.name;
    if ('type' in data) row.type = data.type;
    if ('budget' in data) row.budget = data.budget ?? 0;
    if ('status' in data) row.status = data.status;
    if ('responsibleId' in data) row.responsible_id = data.responsibleId || null;
    if ('responsibleName' in data) row.responsible_name = data.responsibleName || null;
    if ('startDate' in data) row.start_date = data.startDate || null;
    if ('endDate' in data) row.end_date = data.endDate || null;
    if ('notes' in data) row.notes = data.notes || null;
    const { error } = await supabase.from('cost_centers').update(row).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

export async function deleteCostCenter(id: string, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    // Desimputa las OC que apunten a este centro antes de eliminarlo.
    await supabase.from('purchase_orders').update({ cost_center_id: null }).eq('cost_center_id', id).eq('tenant_id', tenantId);
    const { error } = await supabase.from('cost_centers').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
}

// Imputa (o desimputa, con costCenterId=null) una Orden de Compra a un Centro de Costo.
export async function assignOrderCostCenter(orderId: string, costCenterId: string | null, { tenantId }: Context) {
    if (!tenantId) throw new Error('Inquilino no válido.');
    const { error } = await supabase
        .from('purchase_orders')
        .update({ cost_center_id: costCenterId })
        .eq('id', orderId)
        .eq('tenant_id', tenantId);
    if (error) throw error;
}
