
import { supabase } from '@/modules/core/lib/supabase';

import type { MutationContext as Context } from './context';
import {
  DEFAULT_TAX_RATE,
  emitFinanceEntries,
  netFromGross,
  reverseEntriesForSource,
} from './financeLedger';

export async function addSupplierPayment(data: any, { user, tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data: inserted, error } = await supabase.from('supplier_payments').insert({
    ...data,
    status: 'pending',
    tenant_id: tenantId,
    created_at: new Date().toISOString(),
  }).select('id').single();

  if (error) throw error;
  await emitPayableEntry(inserted.id, { user, tenantId });
}

/**
 * Obligación de caja de una factura pendiente (F4.2). NO es un costo nuevo: la
 * recepción ya devengó ese costo, y volver a emitirlo duplicaría el margen. Por
 * eso va con `nature='payable'`, que los paneles de resultado no suman.
 *
 * Monto BRUTO (a diferencia de los hechos de costo, que van en neto): el flujo
 * de caja proyecta lo que efectivamente sale del banco.
 *
 * Se apaga por reverso al pagarse, anularse o eliminarse la factura — nunca por
 * UPDATE (Art. 2). `source_type` propio para que el reverso de la obligación no
 * toque el hecho de costo 'supplier_payment' y viceversa.
 */
async function emitPayableEntry(paymentId: string, { user, tenantId }: Context) {
  const { data: p } = await supabase
    .from('supplier_payments')
    .select('id, amount, due_date, invoice_number, supplier_id, purchase_order_id, status')
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
    .single();
  if (!p || !(Number(p.amount) > 0) || p.status === 'paid') return;

  let supplierName: string | null = null;
  if (p.supplier_id) {
    const { data: sup } = await supabase.from('suppliers').select('name').eq('id', p.supplier_id).single();
    supplierName = sup?.name || null;
  }
  const { contractId, contractName } = await contractFromPurchaseOrder(p.purchase_order_id);

  await emitFinanceEntries([{
    nature: 'payable',
    stage: 'accrued',
    category: 'materials',
    amountNet: Math.round(Number(p.amount)),   // BRUTO: es caja
    taxRate: DEFAULT_TAX_RATE,
    dueDate: p.due_date || null,
    contractId,
    contractName,
    sourceType: 'supplier_invoice',
    sourceId: paymentId,
    sourceCode: p.invoice_number || null,
    counterpartyType: 'supplier',
    counterpartyId: p.supplier_id || null,
    counterpartyName: supplierName,
    notes: `Factura ${p.invoice_number || ''} por pagar${p.due_date ? ` — vence ${p.due_date}` : ' — sin vencimiento'}`,
  }], { user, tenantId });
}

/** Contrato heredado de la OC cuando todas sus solicitudes comparten uno. */
async function contractFromPurchaseOrder(purchaseOrderId: string | null | undefined) {
  if (!purchaseOrderId) return { contractId: null, contractName: null };
  const { data: po } = await supabase
    .from('purchase_orders').select('request_ids').eq('id', purchaseOrderId).single();
  if (!(po?.request_ids || []).length) return { contractId: null, contractName: null };
  const { data: reqs } = await supabase
    .from('purchase_requests').select('contract_id, contract_name').in('id', po!.request_ids);
  const distinct = new Map<string | null, string | null>();
  for (const r of reqs || []) distinct.set(r.contract_id || null, r.contract_name || null);
  if (distinct.size !== 1) return { contractId: null, contractName: null };
  return { contractId: [...distinct.keys()][0], contractName: [...distinct.values()][0] };
}

export async function updateSupplierPayment(paymentId: string, data: any, { user, tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { data: before } = await supabase
    .from('supplier_payments')
    .select('status, amount, due_date')
    .eq('id', paymentId)
    .eq('tenant_id', tenantId)
    .single();

  const { error } = await supabase.from('supplier_payments').update(data).eq('id', paymentId).eq('tenant_id', tenantId);
  if (error) throw error;

  const amountChanged = data.amount !== undefined && Number(data.amount) !== Number(before?.amount);
  const dueChanged = data.due_date !== undefined && String(data.due_date) !== String(before?.due_date);

  // Si cambió el monto de una factura YA pagada, el hecho "pagado" del ledger
  // quedó desactualizado: reverso + hecho nuevo (Art. 2 — nunca se edita).
  if (before?.status === 'paid' && amountChanged) {
    await reverseEntriesForSource(
      'supplier_payment', paymentId,
      `Monto de factura corregido por ${user?.name || 'usuario'}`,
      { user, tenantId },
    );
    await emitPaidEntry(paymentId, { user, tenantId });
  }

  // Si cambió el monto o el VENCIMIENTO de una factura pendiente, su obligación
  // de caja proyectaba mal: se apaga y se vuelve a emitir (F4.2). Repactar un
  // vencimiento es justamente lo que mueve el flujo.
  if (before?.status !== 'paid' && (amountChanged || dueChanged)) {
    await reverseEntriesForSource(
      'supplier_invoice', paymentId,
      `Factura corregida por ${user?.name || 'usuario'}`,
      { user, tenantId },
    );
    await emitPayableEntry(paymentId, { user, tenantId });
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

  // La obligación de caja se apaga: ya no es un pago futuro (F4.2). Va ANTES del
  // hecho de costo para que un fallo no deje la factura pagada y aún proyectada.
  await reverseEntriesForSource(
    'supplier_invoice', paymentId,
    `Factura pagada por ${user?.name || 'usuario'}`,
    { user, tenantId },
  );
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
  // …y su obligación de caja, si seguía pendiente (idempotente si ya se apagó).
  await reverseEntriesForSource(
    'supplier_invoice', paymentId,
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
