import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import { addMonths, addWeeks, addDays, format } from 'date-fns';
import type {
  RentalParty,
  RentalContract,
  RentalAsset,
  RentalPayment,
  RentalBillingCycle,
} from '@/modules/core/lib/data';

import type { MutationContext as Context } from './context';

// ── Contrapartes (arrendadores / clientes) ───────────────────────────────────

export async function addRentalParty(
  data: Omit<RentalParty, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<RentalParty> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('rental_parties')
    .insert({
      tenant_id: tenantId,
      name: data.name,
      party_type: data.partyType,
      rut: data.rut || null,
      contact_name: data.contactName || null,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      bank: data.bank || null,
      account_type: data.accountType || null,
      account_number: data.accountNumber || null,
      notes: data.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.rental_parties(inserted);
}

export async function updateRentalParty(
  id: string,
  data: Partial<RentalParty>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.partyType !== undefined) payload.party_type = data.partyType;
  if (data.rut !== undefined) payload.rut = data.rut;
  if (data.contactName !== undefined) payload.contact_name = data.contactName;
  if (data.email !== undefined) payload.email = data.email;
  if (data.phone !== undefined) payload.phone = data.phone;
  if (data.address !== undefined) payload.address = data.address;
  if (data.bank !== undefined) payload.bank = data.bank;
  if (data.accountType !== undefined) payload.account_type = data.accountType;
  if (data.accountNumber !== undefined) payload.account_number = data.accountNumber;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_parties')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteRentalParty(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_parties')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Contratos de arriendo ─────────────────────────────────────────────────────

export async function addRentalContract(
  data: Omit<RentalContract, 'id' | 'tenantId' | 'createdBy' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<RentalContract> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('rental_contracts')
    .insert({
      tenant_id: tenantId,
      code: data.code || null,
      direction: data.direction,
      party_id: data.partyId,
      title: data.title,
      status: data.status,
      start_date: data.startDate,
      end_date: data.endDate || null,
      billing_cycle: data.billingCycle,
      amount: data.amount,
      currency: data.currency || 'CLP',
      payment_day: data.paymentDay ?? null,
      tax_rate: data.taxRate ?? 19,
      oc_number: data.ocNumber ?? null,
      oc_status: data.ocStatus ?? 'pending',
      oc_sent_at: data.ocSentAt ?? null,
      oc_confirmed_at: data.ocConfirmedAt ?? null,
      payment_terms_days: data.paymentTermsDays ?? 30,
      notes: data.notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.rental_contracts(inserted);
}

export async function updateRentalContract(
  id: string,
  data: Partial<RentalContract>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.code !== undefined) payload.code = data.code;
  if (data.direction !== undefined) payload.direction = data.direction;
  if (data.partyId !== undefined) payload.party_id = data.partyId;
  if (data.title !== undefined) payload.title = data.title;
  if (data.status !== undefined) payload.status = data.status;
  if (data.startDate !== undefined) payload.start_date = data.startDate;
  if (data.endDate !== undefined) payload.end_date = data.endDate;
  if (data.billingCycle !== undefined) payload.billing_cycle = data.billingCycle;
  if (data.amount !== undefined) payload.amount = data.amount;
  if (data.currency !== undefined) payload.currency = data.currency;
  if (data.paymentDay !== undefined) payload.payment_day = data.paymentDay;
  if (data.taxRate !== undefined) payload.tax_rate = data.taxRate;
  if (data.ocNumber !== undefined) payload.oc_number = data.ocNumber;
  if (data.ocStatus !== undefined) payload.oc_status = data.ocStatus;
  if (data.ocSentAt !== undefined) payload.oc_sent_at = data.ocSentAt;
  if (data.ocConfirmedAt !== undefined) payload.oc_confirmed_at = data.ocConfirmedAt;
  if (data.paymentTermsDays !== undefined) payload.payment_terms_days = data.paymentTermsDays;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_contracts')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteRentalContract(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  // Borra cuotas y activos asociados primero (sin depender de ON DELETE CASCADE).
  await supabase.from('rental_payments').delete().eq('contract_id', id).eq('tenant_id', tenantId);
  await supabase.from('rental_assets').delete().eq('contract_id', id).eq('tenant_id', tenantId);

  const { error } = await supabase
    .from('rental_contracts')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

/**
 * Cierra un arriendo (devolución del/los equipo/s). En una sola operación:
 *   1. Marca el contrato como `finished` con `end_date` = fecha de devolución.
 *   2. Marca todos los activos aún `active` del contrato como `returned`
 *      (con su `end_date` = fecha de devolución).
 *   3. (Opcional, por defecto sí) elimina las cuotas pendientes con vencimiento
 *      POSTERIOR a la devolución — corta el calendario. Las cuotas ya vencidas
 *      o pagadas no se tocan (siguen debiéndose / cobrándose).
 */
export async function closeRentalContract(
  contractId: string,
  opts: { returnDate: Date | string; notes?: string; cancelFuturePayments?: boolean },
  { user, tenantId }: Context,
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const returnDateStr = format(new Date(opts.returnDate as any), 'yyyy-MM-dd');

  // 1. Contrato → finalizado.
  const contractPayload: any = { status: 'finished', end_date: returnDateStr };
  if (opts.notes?.trim()) contractPayload.notes = opts.notes.trim();
  const { error: cErr } = await supabase
    .from('rental_contracts')
    .update(contractPayload)
    .eq('id', contractId)
    .eq('tenant_id', tenantId);
  if (cErr) throw cErr;

  // 2. Activos activos → devueltos.
  const { error: aErr } = await supabase
    .from('rental_assets')
    .update({ status: 'returned', end_date: returnDateStr })
    .eq('contract_id', contractId)
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  if (aErr) throw aErr;

  // 3. Cuotas pendientes futuras → eliminadas (corta el calendario).
  if (opts.cancelFuturePayments !== false) {
    const { error: pErr } = await supabase
      .from('rental_payments')
      .delete()
      .eq('contract_id', contractId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .gt('due_date', returnDateStr);
    if (pErr) throw pErr;
  }
}

/** Marca un activo individual como devuelto (devolución parcial en multi-ítem). */
export async function returnRentalAsset(
  id: string,
  returnDate: Date | string,
  { tenantId }: Context,
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_assets')
    .update({ status: 'returned', end_date: format(new Date(returnDate as any), 'yyyy-MM-dd') })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Activos arrendados (líneas del contrato) ─────────────────────────────────

export async function addRentalAsset(
  data: Omit<RentalAsset, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId }: Context
): Promise<RentalAsset> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('rental_assets')
    .insert({
      tenant_id: tenantId,
      contract_id: data.contractId,
      name: data.name,
      category: data.category,
      identifier: data.identifier || null,
      quantity: data.quantity ?? 1,
      unit_price: data.unitPrice ?? null,
      start_date: data.startDate || null,
      end_date: data.endDate || null,
      status: data.status || 'active',
      notes: data.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.rental_assets(inserted);
}

export async function updateRentalAsset(
  id: string,
  data: Partial<RentalAsset>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.category !== undefined) payload.category = data.category;
  if (data.identifier !== undefined) payload.identifier = data.identifier;
  if (data.quantity !== undefined) payload.quantity = data.quantity;
  if (data.unitPrice !== undefined) payload.unit_price = data.unitPrice;
  if (data.startDate !== undefined) payload.start_date = data.startDate;
  if (data.endDate !== undefined) payload.end_date = data.endDate;
  if (data.status !== undefined) payload.status = data.status;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_assets')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteRentalAsset(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_assets')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Pagos / cuotas ────────────────────────────────────────────────────────────

export async function addRentalPayment(
  data: Omit<RentalPayment, 'id' | 'tenantId' | 'createdAt' | 'status'> & { status?: RentalPayment['status'] },
  { user, tenantId }: Context
): Promise<RentalPayment> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: inserted, error } = await supabase
    .from('rental_payments')
    .insert({
      tenant_id: tenantId,
      contract_id: data.contractId,
      due_date: data.dueDate,
      amount: data.amount,
      status: data.status || 'pending',
      paid_date: data.paidDate || null,
      payment_method: data.paymentMethod || null,
      reference: data.reference || null,
      notes: data.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  return mappers.rental_payments(inserted);
}

const CYCLE_STEP: Record<RentalBillingCycle, (d: Date, n: number) => Date> = {
  monthly: (d, n) => addMonths(d, n),
  biweekly: (d, n) => addDays(d, n * 14),
  weekly: (d, n) => addWeeks(d, n),
  daily: (d, n) => addDays(d, n),
  one_time: (d) => d,
};

/**
 * Genera N cuotas para un contrato según el ciclo de facturación. Para `one_time`
 * crea una sola cuota. Inserta en lote.
 *
 * `opts.startFrom` ancla el 1er vencimiento (por defecto la fecha de inicio del
 * contrato); `opts.firstDueOffsetDays` le suma un plazo de pago (ej. 30 días).
 * Así el calendario puede arrancar desde la confirmación de la OC + plazo.
 */
export async function generateRentalSchedule(
  contractId: string,
  installments: number,
  opts: { startFrom?: Date | string; firstDueOffsetDays?: number } | undefined,
  { user, tenantId }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: contractRow, error: cErr } = await supabase
    .from('rental_contracts')
    .select('*')
    .eq('id', contractId)
    .eq('tenant_id', tenantId)
    .single();
  if (cErr) throw cErr;

  const contract = mappers.rental_contracts(contractRow);
  let start = new Date((opts?.startFrom ?? contract.startDate) as any);
  if (opts?.firstDueOffsetDays) start = addDays(start, opts.firstDueOffsetDays);
  const count = contract.billingCycle === 'one_time' ? 1 : Math.max(1, installments);
  const step = CYCLE_STEP[contract.billingCycle];

  const rows = Array.from({ length: count }, (_, i) => {
    let due = step(start, i);
    // Para mensual con día de pago fijo, ajusta el día del mes.
    if (contract.billingCycle === 'monthly' && contract.paymentDay) {
      due = new Date(due.getFullYear(), due.getMonth(), contract.paymentDay);
    }
    return {
      tenant_id: tenantId,
      contract_id: contractId,
      due_date: format(due, 'yyyy-MM-dd'),
      amount: contract.amount,
      status: 'pending' as const,
    };
  });

  const { error } = await supabase.from('rental_payments').insert(rows);
  if (error) throw error;
}

export async function markRentalPaymentPaid(
  id: string,
  details: { paidDate: Date | string; paymentMethod?: string; reference?: string },
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_payments')
    .update({
      status: 'paid',
      paid_date: details.paidDate,
      payment_method: details.paymentMethod || null,
      reference: details.reference || null,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function updateRentalPayment(
  id: string,
  data: Partial<RentalPayment>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = {};
  if (data.dueDate !== undefined) payload.due_date = data.dueDate;
  if (data.amount !== undefined) payload.amount = data.amount;
  if (data.status !== undefined) payload.status = data.status;
  if (data.paidDate !== undefined) payload.paid_date = data.paidDate;
  if (data.paymentMethod !== undefined) payload.payment_method = data.paymentMethod;
  if (data.reference !== undefined) payload.reference = data.reference;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_payments')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteRentalPayment(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_payments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Orden de Compra (OC) del arriendo ─────────────────────────────────────────

/** Marca la OC del contrato como ENVIADA al arrendador. */
export async function markRentalOcSent(contractId: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');
  const { error } = await supabase
    .from('rental_contracts')
    .update({ oc_status: 'sent', oc_sent_at: new Date().toISOString() })
    .eq('id', contractId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

/**
 * CONFIRMA la OC: el contrato pasa a 'active' y RECIÉN AHÍ se genera el
 * calendario de pagos. El 1er vencimiento = confirmación + `firstDueOffsetDays`
 * (plazo de pago). Si ya existen cuotas, no las duplica (sale temprano).
 */
export async function confirmRentalOc(
  contractId: string,
  opts: { installments: number; firstDueOffsetDays?: number },
  context: Context,
): Promise<void> {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado.');

  const now = new Date();
  const termsDays = opts.firstDueOffsetDays ?? 0;

  const { error } = await supabase
    .from('rental_contracts')
    .update({
      oc_status: 'confirmed',
      oc_confirmed_at: now.toISOString(),
      status: 'active',
      payment_terms_days: termsDays,
    })
    .eq('id', contractId)
    .eq('tenant_id', tenantId);
  if (error) throw error;

  // Evita duplicar el calendario si ya se generó antes.
  const { count } = await supabase
    .from('rental_payments')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .eq('tenant_id', tenantId);
  if ((count ?? 0) > 0) return;

  await generateRentalSchedule(
    contractId,
    opts.installments,
    { startFrom: now, firstDueOffsetDays: termsDays },
    context,
  );
}
