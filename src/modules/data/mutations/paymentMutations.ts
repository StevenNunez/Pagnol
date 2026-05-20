
import { supabase } from '@/modules/core/lib/supabase';

type Context = {
  user: any;
  tenantId: string | null;
  db: any;
};

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

export async function updateSupplierPayment(paymentId: string, data: any, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { error } = await supabase.from('supplier_payments').update(data).eq('id', paymentId).eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function markPaymentAsPaid(paymentId: string, details: { paymentDate: Date; paymentMethod: string; }, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");

  const { error } = await supabase.from('supplier_payments').update({
    status: 'paid',
    payment_date: details.paymentDate,
    payment_method: details.paymentMethod
  }).eq('id', paymentId).eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteSupplierPayment(paymentId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
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
