
import { supabase } from '@/modules/core/lib/supabase';

import type { MutationContext as Context } from './context';
import {
  DEFAULT_TAX_RATE,
  emitFinanceEntries,
  netFromGross,
  reverseEntriesForSource,
} from './financeLedger';

export async function addSupplierPayment(data: any, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { error } = await supabase.from('supplier_payments').insert({
    ...data,
    status: 'pending',
    tenant_id: tenantId,
    created_at: new Date().toISOString(),
  });

  if (error) throw error;
}

export async function updateSupplierPayment(paymentId: string, data: any, { user, tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data: before } = await supabase
    .from('supplier_payments')
    .select('status, amount')
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
    .single();

  const { error } = await supabase.from('supplier_payments').update(data).eq('id', paymentId).eq('tenant_id', tenantId);
  if (error) throw error;

  // Si cambió el monto de una factura YA pagada, el hecho "pagado" del ledger
  // quedó desactualizado: reverso + hecho nuevo (Art. 2 — nunca se edita).
  if (before?.status === 'paid' && data.amount !== undefined && Number(data.amount) !== Number(before.amount)) {
    await reverseEntriesForSource(
      'supplier_payment', paymentId,
      `Monto de factura corregido por ${user?.name || 'usuario'}`,
      { user, tenantId },
    );
    await emitPaidEntry(paymentId, { user, tenantId });
  }
}

// Emite el hecho financiero "pagado" de una factura. Convención F0: el monto de
// la factura es BRUTO con IVA 19% → el ledger guarda el neto derivado. El
// contrato se hereda de la OC vinculada cuando todas sus solicitudes comparten
// uno; si no, queda "sin contrato" (visible como alerta en el panel).
async function emitPaidEntry(paymentId: string, { user, tenantId }: Context) {
  const { data: payment } = await supabase
    .from('supplier_payments')
    .select('*')
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
    .single();
  if (!payment || !(Number(payment.amount) > 0)) return;

  let contractId: string | null = null;
  let contractName: string | null = null;
  if (payment.purchase_order_id) {
    const { data: po } = await supabase
      .from('purchase_orders')
      .select('request_ids')
      .eq('id', payment.purchase_order_id)
      .single();
    if ((po?.request_ids || []).length) {
      const { data: reqs } = await supabase
        .from('purchase_requests')
        .select('contract_id, contract_name')
        .in('id', po!.request_ids);
      const distinct = new Map<string | null, string | null>();
      for (const r of reqs || []) distinct.set(r.contract_id || null, r.contract_name || null);
      if (distinct.size === 1) {
        contractId = [...distinct.keys()][0];
        contractName = [...distinct.values()][0];
      }
    }
  }

  let supplierName: string | null = null;
  if (payment.supplier_id) {
    const { data: sup } = await supabase.from('suppliers').select('name').eq('id', payment.supplier_id).single();
    supplierName = sup?.name || null;
  }

  await emitFinanceEntries([{
    nature: 'cost',
    stage: 'paid',
    category: 'materials',
    amountNet: netFromGross(Number(payment.amount)),
    amountOriginal: Number(payment.amount),
    taxRate: DEFAULT_TAX_RATE,
    contractId,
    contractName,
    sourceType: 'supplier_payment',
    sourceId: paymentId,
    sourceCode: payment.invoice_number || null,
    counterpartyType: 'supplier',
    counterpartyId: payment.supplier_id || null,
    counterpartyName: supplierName,
    notes: payment.purchase_order_id
      ? `Pago factura ${payment.invoice_number || ''} (OC ${payment.purchase_order_id})`
      : `Pago factura ${payment.invoice_number || ''} — sin OC vinculada`,
  }], { user, tenantId });
}

export async function markPaymentAsPaid(paymentId: string, details: { paymentDate: Date; paymentMethod: string; }, { user, tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data: rows, error } = await supabase.from('supplier_payments').update({
    status: 'paid',
    payment_date: details.paymentDate,
    payment_method: details.paymentMethod
  }).eq('id', paymentId).eq('tenant_id', tenantId).select('id');

  if (error) throw error;
  if (!rows || rows.length === 0) throw new Error('No se pudo marcar el pago (RLS).');

  await emitPaidEntry(paymentId, { user, tenantId });
}

export async function deleteSupplierPayment(paymentId: string, { user, tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
  // Reverso ANTES de borrar: si estaba pagada, su hecho queda neteado en 0
  // (idempotente — una factura pendiente no tiene hechos que reversar).
  await reverseEntriesForSource(
    'supplier_payment', paymentId,
    `Factura eliminada por ${user?.name || 'usuario'}`,
    { user, tenantId },
  );
  const { error } = await supabase.from('supplier_payments').delete().eq('id', paymentId).eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function addSalaryAdvanceRequest(
  data: { workerId: string; workerName: string; amount: number; },
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { error } = await supabase.from('salary_advances').insert({
    worker_id: data.workerId,
    worker_name: data.workerName,
    amount: data.amount,
    status: 'pending',
    requested_at: new Date().toISOString(),
    tenant_id: tenantId,
  });

  if (error) throw error;
}

export async function approveSalaryAdvance(
  advanceId: string,
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { error } = await supabase.from('salary_advances').update({
    status: 'approved',
    processed_at: new Date().toISOString(),
    approver_id: user.id,
    approver_name: user.name,
  }).eq('id', advanceId).eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function rejectSalaryAdvance(
  advanceId: string,
  rejectionReason: string,
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { error } = await supabase.from('salary_advances').update({
    status: 'rejected',
    processed_at: new Date().toISOString(),
    approver_id: user.id,
    approver_name: user.name,
    rejection_reason: rejectionReason || null,
  }).eq('id', advanceId).eq('tenant_id', tenantId);

  if (error) throw error;
}
