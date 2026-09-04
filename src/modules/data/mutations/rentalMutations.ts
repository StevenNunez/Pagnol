import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import { addMonths, addWeeks, addDays, format } from 'date-fns';
import {
  rentalCategoryLabel,
  type RentalParty,
  type RentalContract,
  type RentalAsset,
  type RentalPayment,
  type RentalBillingCycle,
} from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { addToLedger } from './stockLedger';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { rentalNetToClp } from './financeMath';

import type { MutationContext as Context } from './context';

// ── Contrapartes (arrendadores / clientes) ───────────────────────────────────

/**
 * Puerta de permisos de Arriendos.
 *
 * Las 19 mutaciones del módulo no validaban nada: la pantalla sí gatea sus
 * botones (`rentals:manage_contracts` / `manage_payments` / `manage_parties`),
 * pero por la API quedaba todo abierto — confirmar una OC de arriendo
 * materializa activos y compromete plata en el ledger.
 *
 * `can` resuelve igual que la pantalla, incluidos los permisos que cada empresa
 * personalizó.
 */
function exigir(can: Context['can'], permiso: Parameters<Context['can']>[0], accion: string) {
    if (!can(permiso)) throw new Error(`No tienes permiso para ${accion}.`);
}

export async function addRentalParty(
  data: Omit<RentalParty, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId, can }: Context
): Promise<RentalParty> {
    exigir(can, 'rentals:manage_parties', 'crear arrendadores');

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
  { tenantId, can }: Context
): Promise<void> {
    exigir(can, 'rentals:manage_parties', 'editar arrendadores');

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

export async function deleteRentalParty(id: string, { tenantId, can }: Context): Promise<void> {
    exigir(can, 'rentals:manage_parties', 'eliminar arrendadores');

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
  { user, tenantId, can }: Context
): Promise<RentalContract> {
    exigir(can, 'rentals:manage_contracts', 'crear contratos de arriendo');

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
      client_contract_id: data.clientContractId ?? null,
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
  { tenantId, can }: Context
): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'editar contratos de arriendo');

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
  if (data.clientContractId !== undefined) payload.client_contract_id = data.clientContractId;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_contracts')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Emisores financieros del arriendo (F2 — ADR-004 §4-5) ─────────────────────
// El arriendo es costo `rental`: OC confirmada → COMPROMETIDO (Σ del calendario
// generado); ciclo vencido → DEVENGADO (materializador diario, server-side);
// pago marcado → PAGADO. La dimensión contrato es `client_contract_id` (la
// faena a la que se carga el costo), NO el contrato de arriendo.

/** Dimensiones + tasa UF para emitir hechos de un contrato de arriendo. */
async function rentalFinanceContext(contractRow: {
  client_contract_id?: string | null;
  party_id?: string | null;
  currency?: string | null;
}) {
  let clientContractName: string | null = null;
  if (contractRow.client_contract_id) {
    const { data: c } = await supabase
      .from('contracts').select('name').eq('id', contractRow.client_contract_id).maybeSingle();
    clientContractName = c?.name ?? null;
  }
  let partyName: string | null = null;
  if (contractRow.party_id) {
    // Unificación arrendadores=proveedores: el party puede vivir en suppliers
    // (contratos adjudicados desde RFQ) o en rental_parties (legacy/clientes).
    const { data: s } = await supabase
      .from('suppliers').select('name').eq('id', contractRow.party_id).maybeSingle();
    partyName = s?.name ?? null;
    if (!partyName) {
      const { data: p } = await supabase
        .from('rental_parties').select('name').eq('id', contractRow.party_id).maybeSingle();
      partyName = p?.name ?? null;
    }
  }
  let ufRate: number | null = null;
  if (contractRow.currency === 'UF') {
    const { data: r } = await supabase
      .from('uf_rates').select('value').order('rate_date', { ascending: false }).limit(1).maybeSingle();
    ufRate = r ? Number(r.value) : null;
  }
  return { clientContractName, partyName, ufRate };
}

export async function deleteRentalContract(id: string, context: Context): Promise<void> {
    exigir(context.can, 'rentals:manage_contracts', 'eliminar contratos de arriendo');

  const { tenantId } = context;
  if (!tenantId) throw new Error('No autenticado.');

  // Reversa el comprometido del contrato y los hechos de cada cuota ANTES de
  // borrar las filas (después no queda documento origen que consultar).
  await reverseEntriesForSource('rental_contract', id, 'Contrato de arriendo eliminado', context);
  const { data: pays } = await supabase
    .from('rental_payments')
    .select('id')
    .eq('contract_id', id)
    .eq('tenant_id', tenantId);
  for (const p of pays || []) {
    await reverseEntriesForSource('rental_payment', p.id, 'Contrato de arriendo eliminado', context);
  }

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
  { user, tenantId, can }: Context,
): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'cerrar contratos de arriendo');

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

  // 2b. Archiva los activos espejo en Pagnol (salen del inventario operativo pero
  //     conservan su historial de trazabilidad: movimientos, OT, ficha).
  await supabase
    .from('materials')
    .update({ archived: true })
    .eq('rental_contract_id', contractId)
    .eq('tenant_id', tenantId);

  // 3. Cuotas pendientes futuras → eliminadas (corta el calendario), reversando
  //    antes cualquier hecho que tuvieran (normalmente ninguno: aún no vencían).
  if (opts.cancelFuturePayments !== false) {
    const { data: toDelete } = await supabase
      .from('rental_payments')
      .select('id')
      .eq('contract_id', contractId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .gt('due_date', returnDateStr);
    for (const p of toDelete || []) {
      await reverseEntriesForSource('rental_payment', p.id, 'Arriendo cerrado: calendario cortado', { user, tenantId } as Context);
      // …y la obligación de caja de esa cuota: ya no se va a pagar (F4.2).
      await reverseEntriesForSource('rental_installment', p.id, 'Arriendo cerrado: calendario cortado', { user, tenantId } as Context);
    }
    const { error: pErr } = await supabase
      .from('rental_payments')
      .delete()
      .eq('contract_id', contractId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .gt('due_date', returnDateStr);
    if (pErr) throw pErr;
  }

  // 4. Reajusta el COMPROMETIDO (ADR-004 §4): reverso de lo comprometido vivo y
  //    re-emisión por el calendario que efectivamente quedó (ciclos pagados,
  //    vencidos y pendientes no cortados).
  const reversed = await reverseEntriesForSource(
    'rental_contract', contractId, 'Arriendo cerrado: recompromiso por calendario final', { user, tenantId } as Context,
  );
  if (reversed > 0) {
    const { data: contract } = await supabase
      .from('rental_contracts')
      .select('id, oc_number, code, title, currency, party_id, client_contract_id')
      .eq('id', contractId)
      .eq('tenant_id', tenantId)
      .single();
    const { data: remaining } = await supabase
      .from('rental_payments')
      .select('amount')
      .eq('contract_id', contractId)
      .eq('tenant_id', tenantId);
    const totalOriginal = (remaining || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    if (contract && totalOriginal > 0) {
      const { clientContractName, partyName, ufRate } = await rentalFinanceContext(contract);
      const amountNet = rentalNetToClp(totalOriginal, contract.currency || 'CLP', ufRate);
      if (amountNet > 0) {
        await emitFinanceEntries([{
          nature: 'cost',
          stage: 'committed',
          category: 'rental',
          amountNet,
          currency: contract.currency || 'CLP',
          amountOriginal: totalOriginal,
          fxRate: contract.currency === 'UF' ? ufRate ?? 1 : 1,
          contractId: contract.client_contract_id ?? null,
          contractName: clientContractName,
          sourceType: 'rental_contract',
          sourceId: contractId,
          sourceCode: contract.oc_number || contract.code || null,
          counterpartyType: 'supplier',
          counterpartyId: contract.party_id ?? null,
          counterpartyName: partyName,
          notes: `Arriendo cerrado el ${returnDateStr} — comprometido reajustado al calendario final`,
        }], { user, tenantId } as Context);
      }
    }
  }
}

/** Marca un activo individual como devuelto (devolución parcial en multi-ítem). */
export async function returnRentalAsset(
  id: string,
  returnDate: Date | string,
  { tenantId, can }: Context,
): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'registrar devoluciones de equipos');

  if (!tenantId) throw new Error('No autenticado.');

  const { error } = await supabase
    .from('rental_assets')
    .update({ status: 'returned', end_date: format(new Date(returnDate as any), 'yyyy-MM-dd') })
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;

  // Archiva el activo espejo en Pagnol (conserva su historial de trazabilidad).
  await supabase
    .from('materials')
    .update({ archived: true })
    .eq('rental_asset_id', id)
    .eq('tenant_id', tenantId);
}

/**
 * Materializa los equipos de un contrato de arriendo como activos del módulo Pagnol
 * (registros en `materials` con ownership='arrendado'), para que hereden la trazabilidad
 * de Pagnol (movimientos quién retira/entrega, mantenimiento/OT, ficha técnica, QR).
 *
 * Idempotente: no duplica un activo ya materializado (índice único por `rental_asset_id`).
 * Se llama automáticamente al confirmar la OC; también puede dispararse manualmente para
 * contratos ya activos. Devuelve cuántos activos nuevos creó.
 */
export async function materializeRentalContractAssets(
  contractId: string,
  { user, tenantId, can }: Context,
): Promise<number> {
    exigir(can, 'rentals:manage_contracts', 'materializar los equipos del contrato');

  if (!user || !tenantId) throw new Error('No autenticado.');

  // Solo los activos AÚN en arriendo: un equipo ya devuelto no debe reingresar al inventario.
  const { data: assets, error } = await supabase
    .from('rental_assets')
    .select('*')
    .eq('contract_id', contractId)
    .eq('tenant_id', tenantId)
    .eq('status', 'active');
  if (error) throw error;
  if (!assets?.length) return 0;

  // ¿Cuáles ya tienen material espejo? (evita duplicar)
  const { data: existing } = await supabase
    .from('materials')
    .select('rental_asset_id')
    .eq('tenant_id', tenantId)
    .in('rental_asset_id', assets.map((a) => a.id));
  const done = new Set((existing || []).map((m) => m.rental_asset_id));

  // Contrato (obra) heredado de la solicitud de arriendo que originó este
  // contrato de arriendo. Sin solicitud/obra ⇒ pool central.
  const { data: sourceReq } = await supabase
    .from('rental_requests')
    .select('contract_id, contract_name')
    .eq('rental_contract_id', contractId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle();
  const obraContractId: string | null = sourceReq?.contract_id || null;
  const obraContractName: string | null = sourceReq?.contract_name || null;

  let created = 0;
  for (const a of assets) {
    if (done.has(a.id)) continue;
    const qty = Number(a.quantity) || 1;
    const internalCode = await nextInternalCode(tenantId, 'ACT');

    const { data: mat, error: insErr } = await supabase
      .from('materials')
      .insert({
        name: a.name,
        stock: qty,
        in_use: 0,
        unit: 'Unidad',
        category: rentalCategoryLabel(a.category),
        status: 'Disponible',
        usage_type: 'Reutilizable Controlado',
        unit_cost: a.unit_price ?? null,
        serial_number: a.identifier || null,
        internal_code: internalCode,
        ownership: 'arrendado',
        rental_contract_id: contractId,
        rental_asset_id: a.id,
        archived: false,
        failure_probability: 1,
        failure_impact: 1,
        tenant_id: tenantId,
      })
      .select('id')
      .single();

    if (insErr) {
      // Carrera: otro proceso ya lo creó (viola el índice único). Seguimos sin romper.
      if ((insErr as any).code === '23505') continue;
      throw insErr;
    }

    // Movimiento inicial = ingreso del equipo arrendado al inventario (trazabilidad).
    if (qty > 0) {
      await addToLedger({ tenantId, materialId: mat.id, contractId: obraContractId, qty });
      await supabase.from('stock_movements').insert({
        material_id: mat.id,
        material_name: a.name,
        quantity_change: qty,
        new_stock: qty,
        type: 'initial',
        justification: 'Ingreso por arriendo (OC confirmada)',
        user_id: user.id,
        user_name: user.name,
        contract_id: obraContractId,
        contract_name: obraContractName,
        tenant_id: tenantId,
      });
    }
    created++;
  }
  return created;
}

// ── Activos arrendados (líneas del contrato) ─────────────────────────────────

export async function addRentalAsset(
  data: Omit<RentalAsset, 'id' | 'tenantId' | 'createdAt'>,
  { user, tenantId, can }: Context
): Promise<RentalAsset> {
    exigir(can, 'rentals:manage_contracts', 'agregar equipos al contrato');

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
  { tenantId, can }: Context
): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'editar equipos del contrato');

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

export async function deleteRentalAsset(id: string, { tenantId, can }: Context): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'eliminar equipos del contrato');

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
  { user, tenantId, can }: Context
): Promise<RentalPayment> {
    exigir(can, 'rentals:manage_payments', 'registrar pagos de arriendo');

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
  { user, tenantId, can }: Context
): Promise<void> {
    exigir(can, 'rentals:manage_payments', 'generar el calendario de pagos');

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

  const { data: created, error } = await supabase.from('rental_payments').insert(rows).select('id, due_date, amount');
  if (error) throw error;

  // Obligación de caja por cuota (F4.2). El COSTO ya se comprometió al confirmar
  // la OC y se devenga por ciclo; esto es la otra dimensión: cuánto sale del
  // banco y cuándo. Se apaga por reverso al pagarse o al cortarse el calendario.
  const { clientContractName, partyName, ufRate } = await rentalFinanceContext(contract as any);
  const payables = (created || []).map((p) => {
    const amountOriginal = Number(p.amount) || 0;
    return {
      nature: 'payable' as const,
      stage: 'accrued' as const,
      category: 'rental' as const,
      // BRUTO en CLP: el arriendo en UF se convierte con la tasa vigente; la
      // caja real se ajusta al pagarse (ahí manda la tasa del día del pago).
      amountNet: rentalNetToClp(amountOriginal, contract.currency || 'CLP', ufRate),
      currency: contract.currency || 'CLP',
      amountOriginal,
      fxRate: contract.currency === 'UF' ? ufRate ?? 1 : 1,
      dueDate: p.due_date,
      contractId: contract.clientContractId ?? null,
      contractName: clientContractName,
      sourceType: 'rental_installment',
      sourceId: p.id,
      sourceCode: contract.ocNumber || contract.code || null,
      counterpartyType: 'supplier',
      counterpartyId: contract.partyId ?? null,
      counterpartyName: partyName,
      notes: `Cuota de arriendo por pagar — ${contract.title} (vence ${p.due_date})`,
    };
  }).filter((e) => e.amountNet > 0);
  if (payables.length) await emitFinanceEntries(payables, { user, tenantId } as Context);
}

export async function markRentalPaymentPaid(
  id: string,
  details: { paidDate: Date | string; paymentMethod?: string; reference?: string },
  context: Context
): Promise<void> {
    exigir(context.can, 'rentals:manage_payments', 'marcar pagos de arriendo como pagados');

  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado.');

  // Guarda anti-doble-emisión: solo la transición REAL a 'paid' emite el hecho.
  const { data: updated, error } = await supabase
    .from('rental_payments')
    .update({
      status: 'paid',
      paid_date: details.paidDate,
      payment_method: details.paymentMethod || null,
      reference: details.reference || null,
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .neq('status', 'paid')
    .select('id, contract_id, amount, paid_date');
  if (error) throw error;
  if (!updated?.length) return; // ya estaba pagado: no-op

  // La cuota deja de ser un pago futuro: se apaga su obligación de caja (F4.2).
  await reverseEntriesForSource('rental_installment', id, 'Cuota de arriendo pagada', context);

  // Emisor F2: costo PAGADO del ciclo, fechado el día real del pago.
  const pay = updated[0];
  const { data: contract } = await supabase
    .from('rental_contracts')
    .select('id, oc_number, code, title, currency, party_id, client_contract_id')
    .eq('id', pay.contract_id)
    .eq('tenant_id', tenantId)
    .single();
  if (!contract) return;
  const { clientContractName, partyName, ufRate } = await rentalFinanceContext(contract);
  const amountOriginal = Number(pay.amount) || 0;
  const amountNet = rentalNetToClp(amountOriginal, contract.currency || 'CLP', ufRate);
  if (amountNet > 0) {
    await emitFinanceEntries([{
      entryDate: format(new Date(details.paidDate as any), 'yyyy-MM-dd'),
      nature: 'cost',
      stage: 'paid',
      category: 'rental',
      amountNet,
      currency: contract.currency || 'CLP',
      amountOriginal,
      fxRate: contract.currency === 'UF' ? ufRate ?? 1 : 1,
      contractId: contract.client_contract_id ?? null,
      contractName: clientContractName,
      sourceType: 'rental_payment',
      sourceId: pay.id,
      sourceCode: contract.oc_number || contract.code || null,
      counterpartyType: 'supplier',
      counterpartyId: contract.party_id ?? null,
      counterpartyName: partyName,
      notes: `Ciclo de arriendo pagado — ${contract.title}`,
    }], context);
  }
}

export async function updateRentalPayment(
  id: string,
  data: Partial<RentalPayment>,
  context: Context
): Promise<void> {
    exigir(context.can, 'rentals:manage_payments', 'editar pagos de arriendo');

  const { tenantId } = context;
  if (!tenantId) throw new Error('No autenticado.');

  // Des-marcar un pago (paid → otro estado) debe deshacer sus hechos: se
  // reversa TODO lo vivo de la cuota; el materializador diario re-devenga el
  // ciclo si sigue vencido (dentro de su ventana).
  const { data: before } = await supabase
    .from('rental_payments')
    .select('status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

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

  if (before?.status === 'paid' && data.status !== undefined && data.status !== 'paid') {
    await reverseEntriesForSource('rental_payment', id, 'Pago de arriendo des-marcado', context);
    // Vuelve a ser un pago pendiente: la obligación de caja REVIVE (F4.2), o el
    // flujo mostraría una cuota impaga que ya no proyecta salida.
    await reemitRentalInstallmentPayable(id, context);
  }
}

/** Re-emite la obligación de caja de una cuota que volvió a quedar pendiente. */
async function reemitRentalInstallmentPayable(paymentId: string, context: Context): Promise<void> {
  const { user, tenantId } = context;
  if (!user || !tenantId) return;
  const { data: p } = await supabase
    .from('rental_payments')
    .select('id, due_date, amount, status, contract_id')
    .eq('id', paymentId).eq('tenant_id', tenantId).single();
  if (!p || p.status === 'paid') return;
  const { data: cRow } = await supabase
    .from('rental_contracts').select('*').eq('id', p.contract_id).eq('tenant_id', tenantId).single();
  if (!cRow) return;
  const contract = mappers.rental_contracts(cRow);
  const { clientContractName, partyName, ufRate } = await rentalFinanceContext(contract as any);
  const amountOriginal = Number(p.amount) || 0;
  const amountNet = rentalNetToClp(amountOriginal, contract.currency || 'CLP', ufRate);
  if (amountNet <= 0) return;
  await emitFinanceEntries([{
    nature: 'payable', stage: 'accrued', category: 'rental',
    amountNet, currency: contract.currency || 'CLP', amountOriginal,
    fxRate: contract.currency === 'UF' ? ufRate ?? 1 : 1,
    dueDate: p.due_date,
    contractId: contract.clientContractId ?? null,
    contractName: clientContractName,
    sourceType: 'rental_installment', sourceId: p.id,
    sourceCode: contract.ocNumber || contract.code || null,
    counterpartyType: 'supplier', counterpartyId: contract.partyId ?? null, counterpartyName: partyName,
    notes: `Cuota de arriendo por pagar — ${contract.title} (vence ${p.due_date})`,
  }], context);
}

export async function deleteRentalPayment(id: string, context: Context): Promise<void> {
    exigir(context.can, 'rentals:manage_payments', 'eliminar pagos de arriendo');

  const { tenantId } = context;
  if (!tenantId) throw new Error('No autenticado.');

  // La cuota desaparece: sus hechos (devengado/pagado) y su obligación de caja
  // se reversan ANTES de borrar la fila (después ya no habría documento origen).
  await reverseEntriesForSource('rental_payment', id, 'Cuota de arriendo eliminada', context);
  await reverseEntriesForSource('rental_installment', id, 'Cuota de arriendo eliminada', context);

  const { error } = await supabase
    .from('rental_payments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

// ── Orden de Compra (OC) del arriendo ─────────────────────────────────────────

/** Marca la OC del contrato como ENVIADA al arrendador. */
export async function markRentalOcSent(contractId: string, { tenantId, can }: Context): Promise<void> {
    exigir(can, 'rentals:manage_contracts', 'marcar la OC como enviada');

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
    exigir(context.can, 'rentals:manage_contracts', 'confirmar la OC de arriendo');

  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado.');

  const now = new Date();
  const termsDays = opts.firstDueOffsetDays ?? 0;

  // Estado previo: si la OC ya estaba confirmada, esta corrida es una re-entrada
  // (re-materializar activos) y NO debe volver a comprometer en el ledger.
  const { data: before, error: befErr } = await supabase
    .from('rental_contracts')
    .select('id, oc_status, oc_number, code, title, currency, party_id, client_contract_id')
    .eq('id', contractId)
    .eq('tenant_id', tenantId)
    .single();
  if (befErr || !before) throw new Error('El contrato de arriendo no existe.');
  const firstConfirmation = before.oc_status !== 'confirmed';

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

  // Materializa los equipos como activos del módulo Pagnol (idempotente). El equipo
  // entra a faena al confirmar la OC: aquí empieza su trazabilidad en Pagnol.
  await materializeRentalContractAssets(contractId, context);

  // Evita duplicar el calendario si ya se generó antes.
  const { count } = await supabase
    .from('rental_payments')
    .select('id', { count: 'exact', head: true })
    .eq('contract_id', contractId)
    .eq('tenant_id', tenantId);
  if ((count ?? 0) === 0) {
    await generateRentalSchedule(
      contractId,
      opts.installments,
      { startFrom: now, firstDueOffsetDays: termsDays },
      context,
    );
  }

  // Emisor F2 (ADR-004 §4): COMPROMETIDO = Σ del calendario generado. UF se
  // congela con la tasa del día; sin tasa no se inventa un monto (queda en 0 y
  // el materializador diario devengará ciclo a ciclo igual).
  if (firstConfirmation) {
    const { data: pays } = await supabase
      .from('rental_payments')
      .select('amount')
      .eq('contract_id', contractId)
      .eq('tenant_id', tenantId);
    const totalOriginal = (pays || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
    const { clientContractName, partyName, ufRate } = await rentalFinanceContext(before);
    const amountNet = rentalNetToClp(totalOriginal, before.currency || 'CLP', ufRate);
    if (amountNet > 0) {
      await emitFinanceEntries([{
        nature: 'cost',
        stage: 'committed',
        category: 'rental',
        amountNet,
        currency: before.currency || 'CLP',
        amountOriginal: totalOriginal,
        fxRate: before.currency === 'UF' ? ufRate ?? 1 : 1,
        contractId: before.client_contract_id ?? null,
        contractName: clientContractName,
        sourceType: 'rental_contract',
        sourceId: contractId,
        sourceCode: before.oc_number || before.code || null,
        counterpartyType: 'supplier',
        counterpartyId: before.party_id ?? null,
        counterpartyName: partyName,
        notes: `OC de arriendo confirmada — ${before.title} (${(pays || []).length} ciclo(s))`,
      }], context);
    }
  }
}
