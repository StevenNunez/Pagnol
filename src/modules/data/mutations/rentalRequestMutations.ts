import { supabase } from '@/modules/core/lib/supabase';
import { mappers } from '../mappers';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { addRentalContract, addRentalAsset } from './rentalMutations';
import type {
  RentalRequest,
  RentalQuoteRequest,
  RentalQuoteItem,
  RentalQuoteResponse,
  RentalAssetCategory,
  RentalBillingCycle,
} from '@/modules/core/lib/data';

import type { MutationContext as Context } from './context';

// ── Categorías de Arriendo (gestionables por tenant) ──────────────────────────

export async function addRentalCategory(name: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado o sin inquilino.');
  const clean = (name || '').trim();
  if (!clean) throw new Error('El nombre de la categoría es obligatorio.');
  const { error } = await supabase
    .from('rental_categories')
    .insert({ tenant_id: tenantId, name: clean });
  if (error) {
    // 23505 = violación de índice único (nombre duplicado por tenant).
    if ((error as any).code === '23505') throw new Error('Ya existe una categoría con ese nombre.');
    throw error;
  }
}

export async function updateRentalCategory(id: string, name: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');
  const clean = (name || '').trim();
  if (!clean) throw new Error('El nombre de la categoría es obligatorio.');
  const { error } = await supabase
    .from('rental_categories')
    .update({ name: clean })
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function deleteRentalCategory(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');
  const { error } = await supabase
    .from('rental_categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

// ── Solicitudes de Arriendo ───────────────────────────────────────────────────

export async function addRentalRequest(
  data: {
    // Carrito multi-ítem. Las columnas legacy equipment_name/category/quantity
    // se espejan del primer ítem para compat + el NOT NULL de equipment_name.
    items: { name: string; category: RentalAssetCategory; quantity: number }[];
    startDate?: string | null;
    endDate?: string | null;
    billingCycleEstimate: RentalBillingCycle;
    contractId?: string | null;
    contractName?: string | null;
    area?: string;
    justification?: string;
    supervisorId?: string;
    /**
     * Código heredado del requerimiento que la origina (RFC-004 F3). Cuando
     * viene, la solicitud NO emite su propio correlativo: comparte el del RQ,
     * para que haya UN solo número desde que se pide hasta la OC. Las que se
     * crean por su cuenta siguen emitiendo SOLPED-ARR como siempre.
     */
    internalCode?: string;
  },
  { user, tenantId, can }: Context
): Promise<string> {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const items = (data.items || [])
    .map((it) => ({ name: (it.name || '').trim(), category: it.category, quantity: Number(it.quantity) || 1 }))
    .filter((it) => it.name);
  if (items.length === 0) throw new Error('La solicitud necesita al menos un equipo.');
  const first = items[0];

  const internalCode = data.internalCode || await nextInternalCode(tenantId, 'ARR', 'SOLPED');

  // Si quien crea ya puede autorizar (ADC o superior), salta el gate del ADC.
  const preAuthorized = can('rentals:authorize');
  const now = new Date().toISOString();

  const { data: created, error } = await supabase.from('rental_requests').insert({
    tenant_id: tenantId,
    internal_code: internalCode,
    items,
    equipment_name: first.name,
    category: first.category,
    quantity: first.quantity,
    start_date: data.startDate || null,
    end_date: data.endDate || null,
    billing_cycle_estimate: data.billingCycleEstimate || 'monthly',
    contract_id: data.contractId || null,
    contract_name: data.contractName || null,
    area: data.area || null,
    justification: data.justification || null,
    supervisor_id: data.supervisorId || user.id,
    supervisor_name: user.name || 'Usuario',
    status: 'pending',
    adc_authorized_at: preAuthorized ? now : null,
    adc_authorized_by: preAuthorized ? user.id : null,
    created_at: now,
  }).select('id').single();

  if (error) throw new Error(`Error al crear solicitud de arriendo: ${error.message}`);

  // Push al ADC solo si quedó pendiente de autorización.
  if (!preAuthorized) notifyAuthorizers('rental', { tenantId, code: internalCode, requesterName: user.name || 'Usuario' });

  return created.id;
}

/**
 * Autorización ADC de una solicitud de arriendo. No cambia el `status` (sigue
 * 'pending') — solo levanta el gate para que Abastecimiento la cotice.
 */
export async function authorizeRentalRequest(requestId: string, { user, tenantId, can }: Context): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!can('rentals:authorize'))
    throw new Error('No tienes permiso para autorizar solicitudes de arriendo.');

  const { error } = await supabase
    .from('rental_requests')
    .update({ adc_authorized_at: new Date().toISOString(), adc_authorized_by: user.id })
    .eq('id', requestId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function updateRentalRequestStatus(
  requestId: string,
  status: 'approved' | 'rejected' | 'quoting',
  reason: string | undefined,
  { user, tenantId, can }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const now = new Date().toISOString();
  const payload: any = { status };

  if (status === 'approved') {
    payload.approval_date = now;
    payload.approver_id = user.id;
    payload.approver_name = user.name;
  } else if (status === 'rejected') {
    payload.rejection_date = now;
    payload.rejection_reason = reason || null;
    payload.approver_id = user.id;
    payload.approver_name = user.name;
  }

  const { error } = await supabase
    .from('rental_requests')
    .update(payload)
    .eq('id', requestId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function deleteRentalRequest(requestId: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');
  const { error } = await supabase
    .from('rental_requests')
    .delete()
    .eq('id', requestId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

// ── RFQ de Arriendo (cotización a arrendadores) ───────────────────────────────

export async function addRentalQuoteRequest(
  data: {
    title: string;
    requestIds: string[];
    items: RentalQuoteItem[];
    partyIds: string[];
    deadline?: string;
    notes?: string;
  },
  { user, tenantId, can }: Context
): Promise<RentalQuoteRequest> {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const internalCode = await nextInternalCode(tenantId, 'RFA');

  const { data: inserted, error } = await supabase
    .from('rental_quote_requests')
    .insert({
      tenant_id: tenantId,
      internal_code: internalCode,
      title: data.title,
      status: 'draft',
      request_ids: data.requestIds || [],
      items: data.items || [],
      party_ids: data.partyIds || [],
      responses: [],
      deadline: data.deadline || null,
      notes: data.notes || null,
      created_by: user.id,
      created_by_name: user.name || '',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;

  // Marca las solicitudes incluidas como "en cotización".
  if (data.requestIds?.length) {
    await supabase
      .from('rental_requests')
      .update({ status: 'quoting' })
      .in('id', data.requestIds)
      .eq('tenant_id', tenantId);
  }

  return mappers.rental_quote_requests(inserted);
}

export async function updateRentalQuoteRequest(
  id: string,
  data: Partial<RentalQuoteRequest>,
  { tenantId }: Context
): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  const payload: any = { updated_at: new Date().toISOString() };
  if (data.title !== undefined) payload.title = data.title;
  if (data.status !== undefined) payload.status = data.status;
  if (data.requestIds !== undefined) payload.request_ids = data.requestIds;
  if (data.items !== undefined) payload.items = data.items;
  if (data.partyIds !== undefined) payload.party_ids = data.partyIds;
  if (data.responses !== undefined) payload.responses = data.responses;
  if (data.deadline !== undefined) payload.deadline = data.deadline;
  if (data.notes !== undefined) payload.notes = data.notes;

  const { error } = await supabase
    .from('rental_quote_requests')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId);

  if (error) throw error;
}

export async function sendRentalQuoteRequest(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');
  const { error } = await supabase
    .from('rental_quote_requests')
    .update({ status: 'sent', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

/** Agrega/actualiza una cotización de un arrendador dentro del RFQ (jsonb responses). */
export async function recordRentalQuoteResponse(
  quoteRequestId: string,
  response: Omit<RentalQuoteResponse, 'id' | 'createdAt'> & { id?: string },
  { user, tenantId, can }: Context
): Promise<void> {
  if (!user || !tenantId) throw new Error('No autenticado.');

  const { data: row, error: fetchErr } = await supabase
    .from('rental_quote_requests')
    .select('responses')
    .eq('id', quoteRequestId)
    .eq('tenant_id', tenantId)
    .single();
  if (fetchErr || !row) throw new Error('La cotización no existe.');

  const responses: RentalQuoteResponse[] = row.responses || [];
  const full: RentalQuoteResponse = {
    ...response,
    id: response.id || (globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}`),
    createdAt: new Date().toISOString(),
    createdBy: user.id,
  };
  // Reemplaza si ya existe respuesta de ese arrendador, si no, agrega.
  const idx = responses.findIndex((r) => r.partyId === full.partyId);
  if (idx >= 0) responses[idx] = full;
  else responses.push(full);

  const { error } = await supabase
    .from('rental_quote_requests')
    .update({ responses, updated_at: new Date().toISOString() })
    .eq('id', quoteRequestId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

/**
 * Adjudica una cotización a un arrendador y GENERA el arriendo completo:
 * RentalContract (incoming) + RentalAsset por cada equipo + calendario de pagos.
 * Marca el RFQ como 'awarded' y las solicitudes ligadas como 'fulfilled'.
 */
export async function awardRentalQuote(
  quoteRequestId: string,
  responseId: string,
  options: { currency?: string; paymentDay?: number | null; periods?: number } = {},
  context: Context
): Promise<{ rentalContractId: string; ocNumber: string }> {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const { data: row, error: fetchErr } = await supabase
    .from('rental_quote_requests')
    .select('*')
    .eq('id', quoteRequestId)
    .eq('tenant_id', tenantId)
    .single();
  if (fetchErr || !row) throw new Error('La cotización no existe.');

  const quote = mappers.rental_quote_requests(row);
  const winner = quote.responses.find((r) => r.id === responseId);
  if (!winner) throw new Error('No se encontró la cotización ganadora.');

  const items = quote.items || [];
  const billingCycle: RentalBillingCycle = winner.billingCycle || items[0]?.billingCycle || 'monthly';
  const startDate = items[0]?.startDate || new Date().toISOString().slice(0, 10);
  const endDate = items[0]?.endDate || null;

  // Número de OC del arriendo (correlativo por tenant).
  const ocNumber = await nextInternalCode(tenantId, 'OCA');

  // Imputación al contrato CLIENTE (ADR-004): heredada de las solicitudes de
  // terreno que originaron el RFQ. Si vienen de contratos distintos, queda sin
  // imputar (alerta de calidad de dato, editable en la ficha del arriendo).
  let clientContractId: string | null = null;
  if (quote.requestIds?.length) {
    const { data: reqs } = await supabase
      .from('rental_requests')
      .select('contract_id')
      .in('id', quote.requestIds)
      .eq('tenant_id', tenantId);
    const distinct = [...new Set((reqs || []).map((r) => r.contract_id).filter(Boolean))];
    if (distinct.length === 1) clientContractId = distinct[0] as string;
  }

  // 1) Contrato de arriendo (entrante). Queda 'pending' con la OC por emitir:
  //    el calendario de pagos NO se genera todavía — corre al CONFIRMAR la OC.
  const contract = await addRentalContract(
    {
      direction: 'incoming',
      partyId: winner.partyId,
      title: quote.title || `Arriendo ${quote.internalCode || ''}`.trim(),
      status: 'pending',
      startDate,
      endDate,
      billingCycle,
      amount: winner.pricePerPeriod || 0,
      currency: options.currency || 'CLP',
      paymentDay: options.paymentDay ?? null,
      taxRate: 19,
      ocNumber,
      ocStatus: 'pending',
      paymentTermsDays: 30,
      clientContractId,
      notes: `Generado al adjudicar RFQ ${quote.internalCode || quote.id} a ${winner.partyName}.`,
    },
    context
  );

  // 2) Un activo arrendado por cada equipo del RFQ, con SU precio de línea.
  //    `winner.pricePerPeriod` es el total (suma de líneas), no el de un equipo;
  //    el precio unitario sale de la línea que matchea por itemId. Sin línea
  //    (cotización de total único): si hay 1 ítem se usa el total, si hay varios
  //    se deja en blanco para que el usuario lo complete (no inflar cada activo).
  for (const it of items) {
    const line = winner.lines?.find((l) => l.itemId === it.id);
    const unitPrice = line?.pricePerPeriod
      ?? (items.length === 1 ? (winner.pricePerPeriod || undefined) : undefined);
    await addRentalAsset(
      {
        contractId: contract.id,
        name: it.name,
        category: it.category,
        quantity: line?.quantity ?? it.quantity ?? 1,
        unitPrice,
        startDate: it.startDate || startDate,
        endDate: it.endDate || endDate,
        status: 'active',
      },
      context
    );
  }

  // 3) (Sin calendario de pagos aún: se genera al confirmar la OC.)

  // 4) Cierra el RFQ.
  await supabase
    .from('rental_quote_requests')
    .update({
      status: 'awarded',
      awarded_party_id: winner.partyId,
      awarded_quote_id: winner.id,
      awarded_at: new Date().toISOString(),
      rental_contract_id: contract.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteRequestId)
    .eq('tenant_id', tenantId);

  // 5) Marca las solicitudes como cumplidas.
  if (quote.requestIds?.length) {
    await supabase
      .from('rental_requests')
      .update({ status: 'fulfilled', rental_contract_id: contract.id })
      .in('id', quote.requestIds)
      .eq('tenant_id', tenantId);
  }

  return { rentalContractId: contract.id, ocNumber: contract.ocNumber || ocNumber };
}

export async function deleteRentalQuoteRequest(id: string, { tenantId }: Context): Promise<void> {
  if (!tenantId) throw new Error('No autenticado.');

  // Devuelve las solicitudes ligadas al estado pendiente.
  const { data: row } = await supabase
    .from('rental_quote_requests')
    .select('request_ids, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (row?.status !== 'awarded' && row?.request_ids?.length) {
    await supabase
      .from('rental_requests')
      .update({ status: 'pending' })
      .in('id', row.request_ids)
      .eq('tenant_id', tenantId);
  }

  const { error } = await supabase
    .from('rental_quote_requests')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}
