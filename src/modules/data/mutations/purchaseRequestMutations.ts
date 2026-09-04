

import { supabase } from '@/modules/core/lib/supabase';
import { PurchaseRequest, Material, PurchaseLot, PurchaseOrder, URGENCY_LEAD_DAYS, URGENCY_REASON_MIN } from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { addRentalRequest } from './rentalRequestMutations';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { addToLedger } from './stockLedger';
import { emitFinanceEntries, reverseEntriesForSource, type FinanceEntryInput } from './financeLedger';

import type { MutationContext as Context } from './context';

/**
 * Inserta en purchase_requests tolerando columnas de migraciones aún no
 * aplicadas (internal_code/requester_name/batch_id — ver 20260710010000):
 * intenta con el payload completo y, si Postgres/PostgREST responde "no
 * existe esa columna", la quita y reintenta. Así una solicitud de compra
 * sigue funcionando aunque el usuario no haya corrido la migración todavía.
 *
 * `required` = columnas que NO pueden descartarse en silencio: si falta una
 * de esas, degradar cambiaría el SIGNIFICADO de la fila (p.ej. una solicitud
 * al cliente sin `request_target` se convertiría en una compra normal).
 */
async function insertPurchaseRequestRow(payload: Record<string, any>, required: string[] = []) {
  const attempt = { ...payload };
  const maxRetries = Object.keys(attempt).length;
  for (let i = 0; i <= maxRetries; i++) {
    const { data: row, error } = await supabase.from('purchase_requests').insert(attempt).select().single();
    if (!error) return row;
    const missingColumn = /Could not find the '([^']+)' column/.exec(error.message || '')?.[1];
    if (missingColumn && missingColumn in attempt) {
      if (required.includes(missingColumn)) {
        throw new Error(`Falta la columna '${missingColumn}' en la base de datos — hay una migración pendiente de aplicar.`);
      }
      delete attempt[missingColumn];
      continue;
    }
    throw error;
  }
  throw new Error('No se pudo insertar el requerimiento.');
}

export async function addPurchaseRequest(
  data: Partial<Omit<PurchaseRequest, 'id' | 'status' | 'createdAt' | 'tenantId'>>,
  context: Context
) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  // 'client' = suministro del cliente del contrato (correlativo propio SCL);
  // 'supplier' = requerimiento normal (RQ).
  //
  // CORTE LIMPIO (RFC-004 D5): los nuevos nacen como `RQ`; los ya emitidos
  // conservan su `PRQ` porque son referencia en documentos entregados y el
  // Artículo 2 no admite reescribirlos. Verificado que ningún tenant tenía un
  // prefijo propio configurado para 'PRQ', así que el cambio de tipo no deja
  // ninguna configuración huérfana.
  const isClientSupply = data.requestTarget === 'client';
  if (isClientSupply && !data.clientId) {
    throw new Error('El contrato seleccionado no tiene un cliente asociado — asócialo en Configuración → Clientes antes de solicitar un suministro.');
  }
  const requestId = await nextInternalCode(tenantId, isClientSupply ? 'SCL' : 'RQ');

  // RFC-004 F1: la urgencia se guarda como etiqueta Y como fecha concreta. Sin
  // la fecha, "alta" deja de significar algo a los tres días; sin la etiqueta,
  // no se sabe con qué criterio se pidió esa fecha. Se deriva aquí (y no en la
  // UI) para que cualquier emisor futuro del RQ use la misma regla.
  // Un suministro del cliente no gasta plata propia: el cliente del contrato
  // entrega el material. Por eso no lleva urgencia (no compite por la bandeja
  // de Abastecimiento), ni tipo de gasto, ni proveedor sugerido. Se anula acá
  // además de ocultarlo en el formulario, para que ningún otro emisor —el MCP,
  // el asistente— cree un SCL con datos que no significan nada en él.
  const urgency = isClientSupply ? null : (data.urgency || null);
  const neededBy = data.neededBy || (urgency
    ? new Date(Date.now() + URGENCY_LEAD_DAYS[urgency] * 86400000).toISOString().slice(0, 10)
    : null);

  // Un servicio SIEMPRE trae su subtipo, y un producto nunca: el CHECK de la
  // base lo exige, pero se valida aquí para dar un mensaje entendible.
  const isService = data.requestType === 'servicio';
  if (isService && !data.serviceKind) {
    throw new Error('Indica qué tipo de servicio se está contratando.');
  }

  // Pedir para mañana obliga a decir por qué. Se valida aquí además del CHECK
  // de la base para poder dar un mensaje entendible en vez de un error de
  // Postgres — pero la regla la sostiene la base, que es la que también aplica
  // al MCP y al asistente de IA.
  const urgencyReason = data.urgencyReason?.trim() || null;
  if (urgency === 'alta' && (urgencyReason?.length || 0) < URGENCY_REASON_MIN) {
    throw new Error(`Si lo necesitas para mañana, explica por qué (mínimo ${URGENCY_REASON_MIN} caracteres).`);
  }

  // Si quien crea ya puede autorizar (ADC o superior), salta el gate del ADC.
  const preAuthorized = can('purchase_requests:authorize');
  const now = new Date().toISOString();

  // `id` lo genera Postgres (uuid) — requestId es el código legible que va en
  // `internal_code`, igual que en material_requests/return_requests.
  await insertPurchaseRequestRow({
    material_name: data.materialName,
    quantity: data.quantity,
    unit: data.unit,
    category: data.category,
    area: data.area,
    contract_id: data.contractId || null,
    contract_name: data.contractName || null,
    justification: data.justification || '',
    supervisor_id: data.supervisorId || user.id,
    notes: data.notes,
    status: 'pending',
    tenant_id: tenantId,
    internal_code: requestId,
    requester_name: user.name,
    adc_authorized_at: preAuthorized ? now : null,
    adc_authorized_by: preAuthorized ? user.id : null,
    ...(data.batchId ? { batch_id: data.batchId } : {}),
    ...(isClientSupply ? {
      request_target: 'client',
      client_id: data.clientId,
      client_name: data.clientName || null,
    } : {}),
    // RFC-004 F1 (migración 20260807000000).
    request_type: data.requestType || 'producto',
    service_kind: isService ? data.serviceKind : null,
    expense_kind: isClientSupply ? null : (data.expenseKind || null),
    urgency,
    needed_by: neededBy,
    urgency_reason: urgencyReason,
    item_description: data.itemDescription || null,
    suggested_supplier_id: isClientSupply ? null : (data.suggestedSupplierId || null),
    suggested_supplier_name: isClientSupply ? null : (data.suggestedSupplierName || null),
    created_at: now
  }, [
    ...(isClientSupply ? ['request_target', 'client_id'] : []),
    // Un servicio degradado a producto por falta de columna entraría al pañol
    // como material fantasma: preferimos fallar antes que crear ese hecho.
    ...(data.requestType === 'servicio' ? ['request_type'] : []),
  ]);

  // Push al ADC solo si quedó pendiente de autorización.
  if (!preAuthorized) notifyAuthorizers('purchase', { tenantId, code: requestId, requesterName: user.name });
}

/**
 * Marca solicitudes de suministro (target='client') como enviadas al cliente.
 * Se llama después de que el correo con el PDF salió efectivamente: pasa las
 * filas a 'ordered' (en camino, esperando entrega del cliente) y registra
 * sent_to_client_at/sent_to_client_email. Solo aplica sobre solicitudes ya
 * autorizadas por el ADC. También sirve para REENVIAR: no exige que la fila
 * todavía esté en 'to_send' — sobrescribe fecha y destinatario cada vez.
 */
export async function markClientRequestsSent(requestIds: string[], sentToEmail: string, context: Context) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!requestIds.length) return;

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('purchase_requests')
    .update({ status: 'ordered', sent_to_client_at: now, sent_to_client_email: sentToEmail, ordered_at: now })
    .in('id', requestIds)
    .eq('tenant_id', tenantId)
    .eq('request_target', 'client')
    .not('adc_authorized_at', 'is', null)
    .select('id');
  if (error) throw error;
  if (!updated || updated.length !== requestIds.length) {
    throw new Error('Algunas solicitudes no se pudieron marcar como enviadas (¿faltaba la autorización del ADC?). Recarga la página.');
  }
}

/**
 * Autorización ADC de una solicitud de compra. No cambia el `status` (sigue
 * 'pending') — solo levanta el gate para que Abastecimiento la vea/apruebe.
 */
export async function authorizePurchaseRequest(requestId: string, context: Context) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!can('purchase_requests:authorize'))
    throw new Error('No tienes permiso para autorizar requerimientos.');

  const { error } = await supabase
    .from('purchase_requests')
    .update({ adc_authorized_at: new Date().toISOString(), adc_authorized_by: user.id })
    .eq('id', requestId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function updatePurchaseRequestStatus(
  requestId: string,
  status: PurchaseRequest['status'],
  data: Partial<PurchaseRequest>,
  context: Context
) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: currentReq, error: fetchErr } = await supabase.from('purchase_requests').select('*').eq('id', requestId).single();
  if (fetchErr || !currentReq) throw new Error("Solicitud no encontrada.");
  if (currentReq.tenant_id !== tenantId) throw new Error("No tienes permiso.");

  // Aprobar/rechazar requiere el permiso de gestión de compras — antes
  // cualquier usuario autenticado del tenant podía llamar esta mutación
  // directamente sin pasar por la UI que sí lo verificaba.
  if ((status === 'approved' || status === 'rejected') && !can('purchase_requests:approve')) {
    throw new Error('No tienes permiso para aprobar o rechazar requerimientos.');
  }

  // Gate ADC: la cola de Abastecimiento ya oculta las pendientes sin
  // autorización, pero esta mutación (llamada también desde /pagnol/solicitudes-compra)
  // no lo validaba en servidor — se podía aprobar una compra que el ADC nunca autorizó.
  if (status === 'approved' && !currentReq.adc_authorized_at && !can('purchase_requests:authorize')) {
    throw new Error('Esta solicitud aún no ha sido autorizada por el ADC.');
  }

  const now = new Date().toISOString();
  const updateData: any = {
    status: status,
    notes: data.notes !== undefined ? data.notes : currentReq.notes,
  };

  if (data.quantity !== undefined && data.quantity !== currentReq.quantity && !currentReq.original_quantity) {
    updateData.original_quantity = currentReq.quantity;
    updateData.quantity = data.quantity;
  }

  if (status === 'approved' && currentReq.status !== 'approved') {
    updateData.approver_id = user.id;
    updateData.approver_name = user.name;
    updateData.approval_date = now;
  }

  if (status === 'ordered') {
    updateData.ordered_at = now;
  }

  if (status === 'rejected') {
    updateData.rejection_date = now;
    updateData.rejection_reason = data.notes || "Rechazado en gestión de OC";
  }

  // `.select()`: un UPDATE que la RLS no matchea devuelve 0 filas SIN error, y la
  // pantalla confirmaría una aprobación que nunca se guardó.
  const { data: updated, error } = await supabase
    .from('purchase_requests')
    .update(updateData)
    .eq('id', requestId)
    .select('id');
  if (error) throw error;
  if (!updated || updated.length === 0) {
    throw new Error('No se pudo guardar el cambio de estado: no tienes permiso sobre esta solicitud.');
  }
}

/**
 * Requerimiento de ARRIENDO (RFC-004 F3).
 *
 * El RQ es la puerta; el flujo de arriendos es el que gestiona. Esta función
 * los une sin duplicar identidades:
 *
 *   1. Emite UN código (`MDS-RQ-xxxx`) y se lo pasa a la solicitud de arriendo,
 *      que por una vez no emite el suyo. Un número para toda la cadena.
 *   2. Crea PRIMERO el arriendo, que es el documento dueño del flujo. Si algo
 *      fallara después, lo que queda en pie es el documento que sirve — al
 *      revés quedaría un requerimiento apuntando a un arriendo inexistente.
 *   3. El requerimiento derivado NO lleva estado propio: la bandeja proyecta la
 *      etapa del arriendo. Tampoco pasa por el gate del ADC (ese vive en el
 *      arriendo) ni emite costo (lo emite el calendario de ciclos).
 *
 * Lo que aporta el requerimiento es lo que la solicitud de arriendo no tiene:
 * CeCo, partida, urgencia con su motivo y la descripción del pedido.
 */
export async function addRentalRequirement(
  data: {
    items: { name: string; category: any; quantity: number }[];
    startDate?: string | null;
    endDate?: string | null;
    billingCycleEstimate: any;
    contractId?: string | null;
    contractName?: string | null;
    area?: string;
    justification?: string;
    category: string;              // partida (CeCo)
    urgency?: PurchaseRequest['urgency'];
    urgencyReason?: string | null;
    expenseKind?: PurchaseRequest['expenseKind'];
    itemDescription?: string | null;
    suggestedSupplierId?: string | null;
    suggestedSupplierName?: string | null;
  },
  context: Context,
): Promise<{ code: string; rentalRequestId: string }> {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const items = (data.items || []).filter((it) => (it.name || '').trim());
  if (!items.length) throw new Error('La solicitud necesita al menos un equipo.');
  if (!data.category) throw new Error('Elige la partida (CeCo) del arriendo.');

  const urgency = data.urgency || null;
  const urgencyReason = data.urgencyReason?.trim() || null;
  if (urgency === 'alta' && (urgencyReason?.length || 0) < URGENCY_REASON_MIN) {
    throw new Error(`Si lo necesitas para mañana, explica por qué (mínimo ${URGENCY_REASON_MIN} caracteres).`);
  }

  // Un solo correlativo para las dos filas.
  const code = await nextInternalCode(tenantId, 'RQ');

  const rentalRequestId = await addRentalRequest({
    items,
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    billingCycleEstimate: data.billingCycleEstimate,
    contractId: data.contractId ?? null,
    contractName: data.contractName ?? null,
    area: data.area,
    justification: data.justification,
    internalCode: code,
  }, context);

  const now = new Date().toISOString();
  const summary = items.length === 1
    ? items[0].name
    : `Arriendo de ${items.length} equipos`;

  await insertPurchaseRequestRow({
    material_name: summary,
    // El detalle de equipos vive en la solicitud de arriendo: repetirlo acá
    // sería el mismo carrito en dos tablas, con dos verdades posibles.
    quantity: items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0),
    unit: 'global',
    category: data.category,
    area: data.area,
    contract_id: data.contractId || null,
    contract_name: data.contractName || null,
    justification: data.justification || '',
    supervisor_id: user.id,
    status: 'pending',
    tenant_id: tenantId,
    internal_code: code,
    requester_name: user.name,
    // El gate del ADC vive en el arriendo: si el derivado también lo pidiera,
    // el ADC vería el mismo pedido dos veces en pestañas distintas.
    adc_authorized_at: now,
    adc_authorized_by: user.id,
    request_type: 'servicio',
    service_kind: 'arriendo',
    rental_request_id: rentalRequestId,
    expense_kind: data.expenseKind || null,
    urgency,
    needed_by: urgency ? new Date(Date.now() + URGENCY_LEAD_DAYS[urgency] * 86400000).toISOString().slice(0, 10) : null,
    urgency_reason: urgencyReason,
    item_description: data.itemDescription || null,
    suggested_supplier_id: data.suggestedSupplierId || null,
    suggested_supplier_name: data.suggestedSupplierName || null,
    created_at: now,
  }, ['request_type', 'service_kind', 'rental_request_id']);

  return { code, rentalRequestId };
}

/**
 * Tipo de una OC a partir de las solicitudes que agrupa (RFC-004 F2).
 *
 * NO se permite mezclar servicios y productos en una misma orden: la recepción
 * de una OC de servicio no toca el pañol y devenga en la categoría `services`,
 * y esas dos reglas no pueden aplicarse "a medias" sobre un documento mezclado.
 * Además evita el calce ambiguo por nombre que usan las OC agrupadas.
 */
function resolveOrderType(requests: { requestType?: string | null; materialName?: string }[]): 'producto' | 'servicio' {
  const services = requests.filter((r) => r.requestType === 'servicio');
  if (services.length && services.length !== requests.length) {
    throw new Error(
      'No se puede emitir una orden que mezcle servicios y productos — un servicio no ingresa al pañol al recibirse. Emite una orden por separado para: '
      + services.map((r) => r.materialName).join(', ') + '.',
    );
  }
  return services.length ? 'servicio' : 'producto';
}

export async function receivePurchaseRequest(
  requestId: string,
  receivedQuantity: number,
  existingMaterialId: string | undefined,
  context: Context
) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: request, error: reqErr } = await supabase.from('purchase_requests').select('*').eq('id', requestId).single();
  if (reqErr || !request) throw new Error("Solicitud no encontrada");
  if (request.tenant_id !== tenantId) throw new Error("No tienes permiso.");

  // RFC-004 F2: un servicio NO se recibe por aquí. Este camino existe para
  // ingresar cosas al pañol —crea el material, suma stock y escribe kardex— y
  // además NO emite el hecho financiero. Un servicio cerrado acá quedaría con
  // un activo fantasma y sin costo en el margen del contrato. Su conformidad
  // se registra en Abastecimiento → Recepción, contra su OC, que es el único
  // emisor de ese gasto (la regla de "un solo emisor" que ya mordió tres veces).
  if (request.request_type === 'servicio') {
    throw new Error(
      'Este es un requerimiento de servicio: su conformidad se registra en Abastecimiento → Recepción, contra la orden de compra. Así queda el gasto imputado al contrato y no se crea un activo que no existe.',
    );
  }

  const requestedQuantity = request.quantity;
  const now = new Date().toISOString();
  // Suministro del cliente: los ítems NO se mezclan con el stock propio — se
  // materializan en una fila espejo ownership='cliente' + client_id (patrón de
  // los arrendados), porque al cierre del contrato hay que devolverlos y esa
  // cuenta es imposible si comparten contador con los activos propios.
  const isClientSupply = request.request_target === 'client';
  const isPartial = receivedQuantity < requestedQuantity;

  // Transición atómica PRIMERO, antes de tocar stock: solo avanza si la
  // solicitud sigue en un estado "recibible". Si el botón se clickea dos
  // veces (doble click, reintento tras error de red/columna faltante), el
  // segundo intento encuentra 0 filas afectadas y aborta ANTES de crear
  // material o sumar stock — así ya no se puede duplicar por reintento
  // (esto es justo lo que pasó con VALAR-SCL-0001: 2 clicks, 2 veces stock
  // sumado, porque el UPDATE final fallaba en silencio y el botón seguía ahí).
  const claimUpdate: Record<string, any> = isPartial
    ? {
        quantity: requestedQuantity - receivedQuantity,
        // El saldo de un suministro del cliente sigue "enviado, esperando
        // entrega" (ordered); el de una compra vuelve a gestión (approved).
        status: isClientSupply ? 'ordered' : 'approved',
        lot_id: null,
        notes: `Recepción parcial de ${receivedQuantity}. Pendientes: ${requestedQuantity - receivedQuantity}. ${request.notes || ''}`.trim(),
      }
    : {
        status: 'received',
        received_at: now,
        quantity: receivedQuantity,
        original_quantity: request.original_quantity || requestedQuantity,
      };

  const { data: claimed, error: claimErr } = await supabase
    .from('purchase_requests')
    .update(claimUpdate)
    .eq('id', requestId)
    .in('status', ['approved', 'batched', 'ordered'])
    .select('id');
  if (claimErr) throw claimErr;
  if (!claimed || claimed.length === 0) {
    throw new Error('Esta solicitud ya fue recibida o cambió de estado — recarga la página.');
  }

  // Handle stock and material logic
  let materialId = existingMaterialId;
  let existingMat: any = null;
  if (isClientSupply) {
    // Ignora el material elegido en la UI salvo que ya sea la fila espejo de
    // este mismo cliente; si no, busca (o crea abajo) el espejo correcto.
    const { data: mirror } = await supabase
      .from('materials')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('ownership', 'cliente')
      .eq('client_id', request.client_id)
      .ilike('name', request.material_name)
      .limit(1)
      .maybeSingle();
    existingMat = mirror;
    materialId = mirror?.id;
  } else if (materialId) {
    const { data } = await supabase.from('materials').select('*').eq('id', materialId).single();
    existingMat = data;
  }

  if (!existingMat) {
    // Create new material if it doesn't exist
    const newMatCode = await nextInternalCode(tenantId, 'ACT');
    const { data: newMat, error: newMatErr } = await supabase.from('materials').insert({
      internal_code: newMatCode,
      name: request.material_name,
      stock: receivedQuantity,
      unit: request.unit,
      category: request.category,
      tenant_id: tenantId,
      archived: false,
      ...(isClientSupply ? { ownership: 'cliente', client_id: request.client_id } : {}),
    }).select().single();
    if (newMatErr) throw newMatErr;
    materialId = newMat.id;
  } else {
    const { error: stockErr } = await supabase.from('materials').update({ stock: (existingMat.stock || 0) + receivedQuantity }).eq('id', materialId);
    if (stockErr) throw stockErr;
  }

  // Handle partial or full receipt: la fila original ya quedó actualizada
  // arriba (transición atómica) — en el caso parcial falta crear la fila de
  // historial "recibido" para esta porción.
  if (isPartial) {
    const newRqId = await nextInternalCode(tenantId, isClientSupply ? 'SCL' : 'RQ');
    await insertPurchaseRequestRow({
      internal_code: newRqId,
      material_name: request.material_name,
      quantity: receivedQuantity,
      original_quantity: requestedQuantity,
      status: 'received',
      received_at: now,
      notes: `Parte de la solicitud original ${request.internal_code || requestId}.`,
      tenant_id: tenantId,
      requester_name: request.requester_name,
      supervisor_id: request.supervisor_id,
      contract_id: request.contract_id,
      contract_name: request.contract_name,
      area: request.area,
      unit: request.unit,
      category: request.category,
      ...(isClientSupply ? {
        request_target: 'client',
        client_id: request.client_id,
        client_name: request.client_name,
        sent_to_client_at: request.sent_to_client_at,
      } : {}),
    }, isClientSupply ? ['request_target', 'client_id'] : []);
  }

  // El stock recibido entra al desglose del contrato de la solicitud de compra.
  await addToLedger({
    tenantId,
    materialId: materialId!,
    contractId: request.contract_id ?? null,
    qty: receivedQuantity,
  });

  // Stock Movement
  const movId = await nextInternalCode(tenantId, 'MOV');
  const { error: movErr } = await supabase.from('stock_movements').insert({
    id: movId,
    material_id: materialId,
    material_name: request.material_name,
    quantity_change: receivedQuantity,
    new_stock: ((existingMat?.stock || 0) + receivedQuantity),
    type: 'request-delivery',
    date: now,
    justification: isClientSupply
      ? `Suministro del cliente ${request.client_name || ''} — solicitud ${request.internal_code || requestId}`.trim()
      : `Recepción de OC para solicitud ${requestId}`,
    user_id: user.id,
    user_name: user.name,
    related_request_id: requestId,
    contract_id: request.contract_id || null,
    contract_name: request.contract_name || null,
    tenant_id: tenantId,
  });
  if (movErr) throw movErr;
}

export async function deletePurchaseRequest(requestId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
  const { error } = await supabase.from('purchase_requests').delete().eq('id', requestId);
  if (error) throw error;
}

/**
 * Genera la cotización valorizada (status 'generated') de un lote.
 *
 * Decisión F0 (RFC-002-F0-Plan): toda OC nace VALORIZADA — `prices` trae el
 * precio unitario neto por solicitud (la UI lo precarga desde el catálogo y el
 * usuario lo confirma/ajusta). El documento compromete costo estimado en el
 * ledger financiero desde este momento; la recepción lo devenga con el precio
 * real y retroalimenta el catálogo.
 */
export async function generatePurchaseOrder(
  requests: PurchaseRequest[],
  supplierId: string,
  prices: Record<string, number>,
  { user, tenantId, can }: Context,
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
  if (requests.length === 0) throw new Error("No hay solicitudes para procesar.");
  const missing = requests.filter((r) => !(Number(prices[r.id]) > 0));
  if (missing.length > 0) {
    throw new Error(`Falta el precio unitario de: ${missing.map((r) => r.materialName).join(', ')}.`);
  }

  const lotId = requests[0].lotId;
  const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', supplierId).single();
  if (!supplier) throw new Error("Proveedor no encontrado");

  const orderType = resolveOrderType(requests);
  const orderId = await nextInternalCode(tenantId, 'PUR');

  // Ítems agrupados por material (formato histórico del documento). El precio
  // del grupo es el promedio ponderado si dos solicitudes del mismo material
  // traen precios distintos.
  const itemsMap = new Map<string, any>();
  let totalAmount = 0;
  for (const req of requests) {
    const price = Number(prices[req.id]);
    totalAmount += price * req.quantity;
    const key = req.materialName;
    if (itemsMap.has(key)) {
      const it = itemsMap.get(key);
      const newQty = it.totalQuantity + req.quantity;
      it.price = Math.round((it.price * it.totalQuantity + price * req.quantity) / newQty);
      it.totalQuantity = newQty;
    } else {
      itemsMap.set(key, { name: req.materialName, unit: req.unit, totalQuantity: req.quantity, category: req.category, price });
    }
  }

  const { error: orderErr } = await supabase.from('purchase_orders').insert({
    id: orderId,
    internal_code: orderId,
    supplier_id: supplierId,
    supplier_name: supplier.name,
    created_at: new Date().toISOString(),
    creator_id: user.id,
    creator_name: user.name,
    status: 'generated',
    request_ids: requests.map(r => r.id),
    items: Array.from(itemsMap.values()),
    total_amount: Math.round(totalAmount),
    tenant_id: tenantId,
    lot_id: lotId,
    order_type: orderType,
  });

  if (orderErr) throw orderErr;

  // Recién con la OC persistida se marcan las solicitudes: si el insert falla,
  // ninguna queda en estado 'ordered' fantasma.
  for (const req of requests) {
    await supabase.from('purchase_requests').update({ status: 'ordered' }).eq('id', req.id);
  }

  if (lotId) await supabase.from('purchase_lots').update({ supplier_id: supplierId }).eq('id', lotId);

  // Emisor financiero: comprometido por solicitud (cada una conserva SU contrato).
  await emitFinanceEntries(
    requests.map((req): FinanceEntryInput => ({
      nature: 'cost',
      stage: 'committed',
      // Un servicio se imputa a `services`, no a materiales: si no, ensucia el
      // presupuesto de una partida que no le corresponde.
      category: orderType === 'servicio' ? 'services' : 'materials',
      amountNet: Number(prices[req.id]) * req.quantity,
      contractId: req.contractId ?? null,
      contractName: req.contractName ?? null,
      sourceType: 'purchase_order',
      sourceId: orderId,
      sourceCode: orderId,
      counterpartyType: 'supplier',
      counterpartyId: supplierId,
      counterpartyName: supplier.name,
      notes: `Cotización valorizada — compromiso estimado (${req.materialName} × ${req.quantity})`,
    })),
    { user, tenantId, can },
  );

  return orderId;
}

export async function createPurchaseOrder(
  { lotId, ocNumber, items, totalAmount }: { lotId: string; ocNumber: string; items: any[], totalAmount: number },
  { user, tenantId, can }: Context
): Promise<string> {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  const { data: lot } = await supabase.from('purchase_lots').select('*').eq('id', lotId).single();
  if (!lot) throw new Error("El lote no existe.");
  if (!lot.supplier_id) throw new Error("El lote no tiene un proveedor asociado.");

  const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', lot.supplier_id).single();

  // Tipo de la OC (RFC-004 F2): se lee de las solicitudes que la originan. Si
  // mezclara servicios y productos, `resolveOrderType` corta acá — antes de
  // emitir el documento, no después.
  const rfqReqIds = items.map((i) => i.requestId).filter(Boolean);
  const { data: rfqReqs } = rfqReqIds.length
    ? await supabase.from('purchase_requests').select('id, request_type, material_name').in('id', rfqReqIds)
    : { data: [] as any[] };
  const orderType = resolveOrderType(
    (rfqReqs || []).map((r: any) => ({ requestType: r.request_type, materialName: r.material_name })),
  );

  const { data: order, error: orderErr } = await supabase.from('purchase_orders').insert({
    order_type: orderType,
    official_oc_id: ocNumber,
    lot_id: lotId,
    supplier_id: lot.supplier_id,
    supplier_name: supplier?.name || 'Desconocido',
    created_at: new Date().toISOString(),
    creator_id: user.id,
    creator_name: user.name,
    status: 'issued',
    items: items.map(item => ({
      id: item.requestId,
      name: item.name,
      unit: item.unit,
      totalQuantity: item.quantity,
      price: item.price
    })),
    total_amount: totalAmount,
    tenant_id: tenantId,
  }).select().single();

  if (orderErr) throw orderErr;

  await supabase.from('purchase_lots').update({ status: 'ordered' }).eq('id', lotId);

  for (const item of items) {
    await supabase.from('purchase_requests').update({
      status: 'ordered',
      purchase_order_id: order.id,
      quantity: item.quantity,
    }).eq('id', item.requestId);
  }

  // Emisor financiero: OC firme del flujo RFQ → comprometido por ítem, con el
  // contrato de la solicitud de origen.
  const reqIds = items.map((i) => i.requestId).filter(Boolean);
  const contractByReq = new Map<string, { id: string | null; name: string | null }>();
  if (reqIds.length) {
    const { data: reqs } = await supabase
      .from('purchase_requests')
      .select('id, contract_id, contract_name')
      .in('id', reqIds);
    for (const r of reqs || []) contractByReq.set(r.id, { id: r.contract_id || null, name: r.contract_name || null });
  }
  await emitFinanceEntries(
    items
      .filter((item) => Number(item.price) > 0 && Number(item.quantity) > 0)
      .map((item): FinanceEntryInput => {
        const contract = contractByReq.get(item.requestId) || { id: null, name: null };
        return {
          nature: 'cost',
          stage: 'committed',
          category: orderType === 'servicio' ? 'services' : 'materials',
          amountNet: Number(item.price) * Number(item.quantity),
          contractId: contract.id,
          contractName: contract.name,
          sourceType: 'purchase_order',
          sourceId: order.id,
          sourceCode: ocNumber.trim(),
          counterpartyType: 'supplier',
          counterpartyId: lot.supplier_id,
          counterpartyName: supplier?.name || null,
          notes: `OC firme (RFQ) — ${item.name} × ${item.quantity}`,
        };
      }),
    { user, tenantId, can },
  );

  return order.id;
}

export async function returnToPool(requestIds: string[], { user, tenantId, can }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  for (const reqId of requestIds) {
    await supabase.from('purchase_requests').update({
      status: 'approved',
      lot_id: null,
      notes: 'Devuelto a pendientes por Finanzas. Proveedor no cotizó.'
    }).eq('id', reqId);
  }
}

export async function cancelPurchaseOrder(orderId: string, { user, tenantId, can }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  const { data: order } = await supabase.from('purchase_orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error("La orden no existe.");
  if (order.status === 'completed') throw new Error("La OC ya fue recibida: no puede anularse.");

  if (order.request_ids && order.request_ids.length > 0) {
    for (const reqId of order.request_ids) {
      await supabase.from('purchase_requests').update({ status: 'batched' }).eq('id', reqId);
    }
  }

  // Fix F0: antes se hacía DELETE de la fila — el documento desaparecía sin
  // rastro. Ahora se anula (soft-cancel) y sus hechos financieros se reversan
  // (Art. 2: nunca se borra un hecho; se emite el espejo).
  const { data: rows, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'cancelled', processed_at: new Date().toISOString(), processed_by: user.id })
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .select('id');
  if (error) throw error;
  if (!rows || rows.length === 0) throw new Error('No se pudo anular la orden (RLS).');

  await reverseEntriesForSource('purchase_order', orderId, `OC anulada por ${user.name}`, { user, tenantId, can });
}

export async function archiveLot(requestIds: string[], { user, tenantId, can }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");
  for (const id of requestIds) {
    await supabase.from('purchase_requests').update({
      status: 'ordered',
      notes: 'Archivado manualmente desde gestión de lotes.'
    }).eq('id', id);
  }
}
