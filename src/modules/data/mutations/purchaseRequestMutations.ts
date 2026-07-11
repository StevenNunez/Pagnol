

import { supabase } from '@/modules/core/lib/supabase';
import { PurchaseRequest, Material, PurchaseLot, PurchaseOrder } from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { userCan } from '@/modules/core/lib/permissions';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { addToLedger } from './stockLedger';

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
        throw new Error(`Falta la columna '${missingColumn}' en la base de datos — aplica la migración pendiente (20260713000000_client_supply_requests).`);
      }
      delete attempt[missingColumn];
      continue;
    }
    throw error;
  }
  throw new Error('No se pudo insertar la solicitud de compra.');
}

export async function addPurchaseRequest(
  data: Partial<Omit<PurchaseRequest, 'id' | 'status' | 'createdAt' | 'tenantId'>>,
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  // 'client' = suministro del cliente del contrato (correlativo propio SCL);
  // 'supplier' = compra normal (histórico, PRQ).
  const isClientSupply = data.requestTarget === 'client';
  if (isClientSupply && !data.clientId) {
    throw new Error('El contrato seleccionado no tiene un cliente asociado — asócialo en Configuración → Clientes antes de solicitar un suministro.');
  }
  const requestId = await nextInternalCode(tenantId, isClientSupply ? 'SCL' : 'PRQ');

  // Si quien crea ya puede autorizar (ADC o superior), salta el gate del ADC.
  const preAuthorized = userCan(user, 'purchase_requests:authorize');
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
    created_at: now
  }, isClientSupply ? ['request_target', 'client_id'] : []);

  // Push al ADC solo si quedó pendiente de autorización.
  if (!preAuthorized) notifyAuthorizers('purchase', { tenantId, code: requestId, requesterName: user.name });
}

/**
 * Marca solicitudes de suministro (target='client') como enviadas al cliente.
 * Se llama después de que el correo con el PDF salió efectivamente: pasa las
 * filas a 'ordered' (en camino, esperando entrega del cliente) y registra
 * sent_to_client_at. Solo aplica sobre solicitudes ya autorizadas por el ADC.
 */
export async function markClientRequestsSent(requestIds: string[], context: Context) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!requestIds.length) return;

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('purchase_requests')
    .update({ status: 'ordered', sent_to_client_at: now, ordered_at: now })
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
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!userCan(user, 'purchase_requests:authorize'))
    throw new Error('No tienes permiso para autorizar solicitudes de compra.');

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
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: currentReq, error: fetchErr } = await supabase.from('purchase_requests').select('*').eq('id', requestId).single();
  if (fetchErr || !currentReq) throw new Error("Solicitud no encontrada.");
  if (currentReq.tenant_id !== tenantId) throw new Error("No tienes permiso.");

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

  const { error } = await supabase.from('purchase_requests').update(updateData).eq('id', requestId);
  if (error) throw error;
}

export async function receivePurchaseRequest(
  requestId: string,
  receivedQuantity: number,
  existingMaterialId: string | undefined,
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: request, error: reqErr } = await supabase.from('purchase_requests').select('*').eq('id', requestId).single();
  if (reqErr || !request) throw new Error("Solicitud no encontrada");

  const requestedQuantity = request.quantity;
  const now = new Date().toISOString();
  // Suministro del cliente: los ítems NO se mezclan con el stock propio — se
  // materializan en una fila espejo ownership='cliente' + client_id (patrón de
  // los arrendados), porque al cierre del contrato hay que devolverlos y esa
  // cuenta es imposible si comparten contador con los activos propios.
  const isClientSupply = request.request_target === 'client';

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
    await supabase.from('materials').update({ stock: (existingMat.stock || 0) + receivedQuantity }).eq('id', materialId);
  }

  // Handle partial or full receipt
  if (receivedQuantity < requestedQuantity) {
    const remainingQuantity = requestedQuantity - receivedQuantity;
    await supabase.from('purchase_requests').update({
      quantity: remainingQuantity,
      // El saldo de un suministro del cliente sigue "enviado, esperando
      // entrega" (ordered); el de una compra vuelve a gestión (approved).
      status: isClientSupply ? 'ordered' : 'approved',
      lot_id: null,
      notes: `Recepción parcial de ${receivedQuantity}. Pendientes: ${remainingQuantity}. ${request.notes || ''}`.trim(),
    }).eq('id', requestId);

    // Create a new received request for history
    const newPrqId = await nextInternalCode(tenantId, isClientSupply ? 'SCL' : 'PRQ');
    await insertPurchaseRequestRow({
      internal_code: newPrqId,
      material_name: request.material_name,
      quantity: receivedQuantity,
      original_quantity: requestedQuantity,
      status: 'received',
      received_at: now,
      notes: `Parte de la solicitud original ${request.internal_code || requestId}.`,
      tenant_id: tenantId,
      requester_name: request.requester_name,
      unit: request.unit,
      category: request.category,
      ...(isClientSupply ? {
        request_target: 'client',
        client_id: request.client_id,
        client_name: request.client_name,
        sent_to_client_at: request.sent_to_client_at,
      } : {}),
    }, isClientSupply ? ['request_target', 'client_id'] : []);
  } else {
    await supabase.from('purchase_requests').update({
      status: 'received',
      received_at: now,
      quantity: receivedQuantity,
      original_quantity: request.original_quantity || requestedQuantity,
    }).eq('id', requestId);
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
  await supabase.from('stock_movements').insert({
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
}

export async function deletePurchaseRequest(requestId: string, { tenantId }: Context) {
  if (!tenantId) throw new Error("Inquilino no válido.");
  const { error } = await supabase.from('purchase_requests').delete().eq('id', requestId);
  if (error) throw error;
}

export async function generatePurchaseOrder(requests: PurchaseRequest[], supplierId: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
  if (requests.length === 0) throw new Error("No hay solicitudes para procesar.");

  const lotId = requests[0].lotId;
  const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', supplierId).single();
  if (!supplier) throw new Error("Proveedor no encontrado");

  const orderId = await nextInternalCode(tenantId, 'PUR');

  const itemsMap = new Map<string, any>();
  for (const req of requests) {
    const key = req.materialName;
    if (itemsMap.has(key)) itemsMap.get(key).totalQuantity += req.quantity;
    else itemsMap.set(key, { name: req.materialName, unit: req.unit, totalQuantity: req.quantity, category: req.category });

    await supabase.from('purchase_requests').update({ status: 'ordered' }).eq('id', req.id);
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
    tenant_id: tenantId,
    lot_id: lotId,
  });

  if (orderErr) throw orderErr;

  if (lotId) await supabase.from('purchase_lots').update({ supplier_id: supplierId }).eq('id', lotId);

  return orderId;
}

export async function createPurchaseOrder(
  { lotId, ocNumber, items, totalAmount }: { lotId: string; ocNumber: string; items: any[], totalAmount: number },
  { user, tenantId }: Context
): Promise<string> {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  const { data: lot } = await supabase.from('purchase_lots').select('*').eq('id', lotId).single();
  if (!lot) throw new Error("El lote no existe.");
  if (!lot.supplier_id) throw new Error("El lote no tiene un proveedor asociado.");

  const { data: supplier } = await supabase.from('suppliers').select('name').eq('id', lot.supplier_id).single();

  const { data: order, error: orderErr } = await supabase.from('purchase_orders').insert({
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

  return order.id;
}

export async function returnToPool(requestIds: string[], { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  for (const reqId of requestIds) {
    await supabase.from('purchase_requests').update({
      status: 'approved',
      lot_id: null,
      notes: 'Devuelto a pendientes por Finanzas. Proveedor no cotizó.'
    }).eq('id', reqId);
  }
}

export async function cancelPurchaseOrder(orderId: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");

  const { data: order } = await supabase.from('purchase_orders').select('*').eq('id', orderId).single();
  if (!order) throw new Error("La orden no existe.");

  if (order.request_ids && order.request_ids.length > 0) {
    for (const reqId of order.request_ids) {
      await supabase.from('purchase_requests').update({ status: 'batched' }).eq('id', reqId);
    }
  }

  const { error } = await supabase.from('purchase_orders').delete().eq('id', orderId);
  if (error) throw error;
}

export async function archiveLot(requestIds: string[], { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error("Autenticación requerida");
  for (const id of requestIds) {
    await supabase.from('purchase_requests').update({
      status: 'ordered',
      notes: 'Archivado manualmente desde gestión de lotes.'
    }).eq('id', id);
  }
}
