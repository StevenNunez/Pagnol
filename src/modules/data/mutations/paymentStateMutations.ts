import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { userCan } from '@/modules/core/lib/permissions';
import type { WorkItem } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { epPeriodEarned } from './financeMath';

// Estado de Pago (RFC-002-F2-Plan / ADR-004): el documento con el que se cobra
// el avance al mandante. Máquina de estados pending → approved → paid, con
// annulled como salida desde cualquier estado.
//
// Convención de ingreso (ADR-004 §2): al CREAR se congela el delta del período
// (period_earned = acumulado actual − acumulado del último EP vivo del
// contrato); al APROBAR se devenga ese delta (ingreso, categoría 'revenue');
// al COBRAR se emite el pagado con la fecha real. El acumulado (earned_value)
// es dato del documento y JAMÁS se devenga (duplicaría los EP anteriores).

export interface AddPaymentStateInput {
    /** Raíz WBS de la obra (work_item tipo obra) — el contrato se hereda de ahí. */
    workItemRootId: string;
    totalValue: number;
    earnedValue: number;
    items: WorkItem[];
}

export async function addPaymentState(
    data: AddPaymentStateInput,
    { user, tenantId }: Context,
): Promise<string> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

    // Contrato heredado de la raíz WBS (puente ADR-004 §1). Sin puente el EP
    // nace "Sin contrato" (alerta de calidad de dato, no bloqueo).
    const { data: root, error: rootErr } = await supabase
        .from('work_items')
        .select('id, contract_id')
        .eq('id', data.workItemRootId)
        .eq('tenant_id', tenantId)
        .single();
    if (rootErr || !root) throw new Error('La obra (raíz WBS) del estado de pago no existe.');

    let contractName: string | null = null;
    if (root.contract_id) {
        const { data: c } = await supabase
            .from('contracts')
            .select('name')
            .eq('id', root.contract_id)
            .single();
        contractName = c?.name ?? null;
    }

    // Acumulado del último EP vivo (no anulado) de la misma obra: base del delta.
    const { data: prev, error: prevErr } = await supabase
        .from('payment_states')
        .select('earned_value')
        .eq('tenant_id', tenantId)
        .eq('work_item_root_id', data.workItemRootId)
        .neq('status', 'annulled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (prevErr) throw prevErr;

    const previousEarned = Number(prev?.earned_value) || 0;
    const periodEarned = epPeriodEarned(data.earnedValue, previousEarned);
    if (periodEarned <= 0) {
        throw new Error(
            `No hay avance nuevo que cobrar: el acumulado actual (${Math.round(data.earnedValue).toLocaleString('es-CL')}) ` +
            `no supera el del último estado de pago (${Math.round(previousEarned).toLocaleString('es-CL')}).`,
        );
    }

    const internalCode = await nextInternalCode(tenantId, 'EP');

    const { data: newPS, error } = await supabase
        .from('payment_states')
        .insert({
            internal_code: internalCode,
            total_value: Math.round(data.totalValue),
            earned_value: Math.round(data.earnedValue),
            previous_earned: Math.round(previousEarned),
            period_earned: periodEarned,
            items: data.items ?? [],
            work_item_root_id: data.workItemRootId,
            contract_id: root.contract_id ?? null,
            contract_name: contractName,
            contractor_id: user.id,
            contractor_name: user.name,
            status: 'pending',
            tenant_id: tenantId,
        })
        .select('id')
        .single();
    if (error) throw error;
    return newPS.id;
}

/** Datos mínimos del EP para las transiciones (con guarda de tenant). */
async function getPaymentState(id: string, tenantId: string) {
    const { data: ps, error } = await supabase
        .from('payment_states')
        .select('id, status, internal_code, period_earned, contract_id, contract_name')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();
    if (error || !ps) throw new Error('El estado de pago no existe.');
    return ps;
}

/**
 * Aprobar (permiso `payment_states:approve`) → emite el INGRESO DEVENGADO del
 * período. El emisor es parte de la transición: si el hecho no puede
 * registrarse, la aprobación no ocurre.
 */
export async function approvePaymentState(id: string, { user, tenantId }: Context): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!userCan(user, 'payment_states:approve'))
        throw new Error('No tienes permiso para aprobar estados de pago.');

    const ps = await getPaymentState(id, tenantId);
    if (ps.status !== 'pending') throw new Error(`El estado de pago está '${ps.status}', no puede aprobarse.`);

    // Contraparte = el cliente del contrato (snapshot al aprobar).
    let clientId: string | null = null, clientName: string | null = null;
    if (ps.contract_id) {
        const { data: c } = await supabase
            .from('contracts')
            .select('client_id, client_name')
            .eq('id', ps.contract_id)
            .single();
        clientId = c?.client_id ?? null;
        clientName = c?.client_name ?? null;
    }

    // Guarda anti-RLS-silenciosa: la transición debe haber ocurrido de verdad.
    const { data: updated, error } = await supabase
        .from('payment_states')
        .update({
            status: 'approved',
            approved_at: new Date().toISOString(),
            approved_by: user.id,
            approved_by_name: user.name,
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .eq('status', 'pending')
        .select('id');
    if (error) throw error;
    if (!updated?.length) throw new Error('No se pudo aprobar el estado de pago (¿ya cambió de estado?).');

    await emitFinanceEntries([{
        nature: 'income',
        stage: 'accrued',
        category: 'revenue',
        amountNet: Number(ps.period_earned) || 0,
        contractId: ps.contract_id ?? null,
        contractName: ps.contract_name ?? null,
        sourceType: 'payment_state',
        sourceId: ps.id,
        sourceCode: ps.internal_code ?? null,
        counterpartyType: 'client',
        counterpartyId: clientId,
        counterpartyName: clientName,
        notes: `EP aprobado — avance del período`,
    }], { user, tenantId });
}

/**
 * Marcar cobrado (permiso `payment_states:pay`, decisión ADR-004 §3: manual con
 * fecha en v1) → emite el INGRESO PAGADO con la fecha real del cobro.
 */
export async function markPaymentStatePaid(
    id: string,
    paidDate: string, // YYYY-MM-DD
    { user, tenantId }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!userCan(user, 'payment_states:pay'))
        throw new Error('No tienes permiso para registrar cobros de estados de pago.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) throw new Error('Fecha de cobro inválida.');

    const ps = await getPaymentState(id, tenantId);
    if (ps.status !== 'approved') throw new Error(`El estado de pago está '${ps.status}', solo un EP aprobado puede cobrarse.`);

    let clientId: string | null = null, clientName: string | null = null;
    if (ps.contract_id) {
        const { data: c } = await supabase
            .from('contracts').select('client_id, client_name').eq('id', ps.contract_id).single();
        clientId = c?.client_id ?? null;
        clientName = c?.client_name ?? null;
    }

    const { data: updated, error } = await supabase
        .from('payment_states')
        .update({ status: 'paid', paid_at: paidDate, paid_by: user.id })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .eq('status', 'approved')
        .select('id');
    if (error) throw error;
    if (!updated?.length) throw new Error('No se pudo registrar el cobro (¿el EP cambió de estado?).');

    await emitFinanceEntries([{
        entryDate: paidDate,
        nature: 'income',
        stage: 'paid',
        category: 'revenue',
        amountNet: Number(ps.period_earned) || 0,
        contractId: ps.contract_id ?? null,
        contractName: ps.contract_name ?? null,
        sourceType: 'payment_state',
        sourceId: ps.id,
        sourceCode: ps.internal_code ?? null,
        counterpartyType: 'client',
        counterpartyId: clientId,
        counterpartyName: clientName,
        notes: `EP cobrado`,
    }], { user, tenantId });
}

/**
 * Anular (permiso `payment_states:approve`): soft-annul + reverso de TODO lo
 * vivo del documento (devengado y/o pagado). El EP anulado deja de contar como
 * "último acumulado" para el delta del siguiente EP.
 */
export async function annulPaymentState(id: string, reason: string, { user, tenantId }: Context): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!userCan(user, 'payment_states:approve'))
        throw new Error('No tienes permiso para anular estados de pago.');

    const ps = await getPaymentState(id, tenantId);
    if (ps.status === 'annulled') return; // idempotente

    const { data: updated, error } = await supabase
        .from('payment_states')
        .update({
            status: 'annulled',
            annulled_at: new Date().toISOString(),
            annulled_by: user.id,
            notes: reason || null,
        })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .neq('status', 'annulled')
        .select('id');
    if (error) throw error;
    if (!updated?.length) throw new Error('No se pudo anular el estado de pago.');

    await reverseEntriesForSource('payment_state', ps.id, reason || 'EP anulado', { user, tenantId } as Context);
}
