import { supabase } from '@/modules/core/lib/supabase';
import { userCan } from '@/modules/core/lib/permissions';
import type { FinanceBudgetEntry, FinanceCategory } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

// Presupuesto de costo (F3 — ADR-005): líneas append-only por contrato ×
// categoría. Línea inicial y modificaciones son lo mismo: un INSERT con motivo;
// el vigente es la suma (rebajas en negativo). Sin UPDATE/DELETE (Art. 2).

export async function addBudgetEntry(
    data: {
        contractId: string;
        category: Exclude<FinanceCategory, 'revenue'>;
        amountNet: number;
        reason: string;
    },
    { user, tenantId }: Context,
): Promise<FinanceBudgetEntry> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!userCan(user, 'finance:manage'))
        throw new Error('No tienes permiso para administrar presupuestos.');
    const amount = Math.round(Number(data.amountNet));
    if (!Number.isFinite(amount) || amount === 0)
        throw new Error('El monto de la línea de presupuesto no puede ser 0.');
    if (!data.reason?.trim())
        throw new Error('Toda línea de presupuesto lleva motivo (es el historial auditable).');

    const { data: inserted, error } = await supabase
        .from('finance_budget_entries')
        .insert({
            tenant_id: tenantId,
            contract_id: data.contractId,
            category: data.category,
            amount_net: amount,
            reason: data.reason.trim(),
            created_by: user.id,
            created_by_name: user.name,
        })
        .select()
        .single();
    if (error) throw error;
    return mapBudgetEntry(inserted);
}

export function mapBudgetEntry(item: any): FinanceBudgetEntry {
    return {
        id: item.id,
        tenantId: item.tenant_id,
        contractId: item.contract_id,
        category: item.category,
        workItemId: item.work_item_id || null,
        amountNet: Number(item.amount_net) || 0,
        reason: item.reason,
        createdBy: item.created_by || null,
        createdByName: item.created_by_name || null,
        createdAt: item.created_at,
    };
}

/** Lectura directa RLS-protegida (tabla pequeña; sin DataProvider — patrón panel F0). */
export async function fetchBudgetEntries(tenantId: string): Promise<FinanceBudgetEntry[]> {
    const { data, error } = await supabase
        .from('finance_budget_entries')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapBudgetEntry);
}
