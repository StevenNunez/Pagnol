

import { supabase } from '@/modules/core/lib/supabase';
import { PurchaseRequest, Material, PurchaseLot, PurchaseOrder } from '@/modules/core/lib/data';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';

type Context = {
  user: any;
  tenantId: string | null;
  db: any;
};

export async function addPurchaseRequest(
  data: Partial<Omit<PurchaseRequest, 'id' | 'status' | 'createdAt' | 'tenantId'>>,
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const requestId = await nextInternalCode(tenantId, 'PRQ');

  const { error } = await supabase.from('purchase_requests').insert({
    id: requestId,
    internal_code: requestId,
    material_name: data.materialName,
    quantity: data.quantity,
    unit: data.unit,
    category: data.category,
    justification: data.justification || '',
    supervisor_id: data.supervisorId || user.id,
    notes: data.notes,
    status: 'pending',
    tenant_id: tenantId,
    requester_name: user.name,
    created_at: new Date().toISOString()
  });

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

  // Handle stock and material logic
  let materialId = existingMaterialId;
  const { data: existingMat } = await supabase.from('materials').select('*').eq('id', materialId || '').single();

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
      status: 'approved',
      lot_id: null,
      notes: `Recepción parcial de ${receivedQuantity}. Pendientes: ${remainingQuantity}. ${request.notes || ''}`.trim(),
    }).eq('id', requestId);

    // Create a new received request for history
    const newPrqId = await nextInternalCode(tenantId, 'PRQ');
    await supabase.from('purchase_requests').insert({
      id: newPrqId,
      internal_code: newPrqId,
      material_name: request.material_name,
      quantity: receivedQuantity,
      original_quantity: requestedQuantity,
      status: 'received',
      received_at: now,
      notes: `Parte de la solicitud original ${requestId}.`,
      tenant_id: tenantId,
      requester_name: request.requester_name,
      unit: request.unit,
      category: request.category
    });
  } else {
    await supabase.from('purchase_requests').update({
      status: 'received',
      received_at: now,
      quantity: receivedQuantity,
      original_quantity: request.original_quantity || requestedQuantity,
    }).eq('id', requestId);
  }

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
    justification: `Recepción de OC para solicitud ${requestId}`,
    user_id: user.id,
    user_name: user.name,
    related_request_id: requestId,
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
