

import { supabase } from '@/modules/core/lib/supabase';
import { MaterialRequest, Material, ReturnRequest, UserRole } from '@/modules/core/lib/data';
import { ROLES, Permission, userCan } from '@/modules/core/lib/permissions';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { addToLedger, consumeFromLedger, describeConsumeSources } from './stockLedger';

import type { MutationContext as Context } from './context';

export async function addMaterialRequest(
  requestData: {
    items: { materialId: string; quantity: number }[];
    area: string;
    contractId?: string | null;
    contractName?: string | null;
    supervisorId: string;
    supervisorName?: string;
    highestClass?: 'A' | 'B' | 'C';
    tenantPrefix?: string;
  },
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const supervisorName = requestData.supervisorName || user.name || 'Usuario';
  const highestClass = requestData.highestClass || 'A';

  const requestId = await nextInternalCode(tenantId, 'TX');

  // Si quien crea ya puede autorizar (ADC o superior), la solicitud entra
  // pre-autorizada y salta el gate del ADC, directo a la cola del pañol.
  const preAuthorized = userCan(user, 'material_requests:authorize');
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('material_requests')
    .insert({
      internal_code: requestId,
      items: requestData.items,
      area: requestData.area,
      contract_id: requestData.contractId || null,
      contract_name: requestData.contractName || null,
      supervisor_id: requestData.supervisorId,
      supervisor_name: supervisorName,
      highest_class: highestClass,
      status: 'pending',
      notes: '',
      tenant_id: tenantId,
      adc_authorized_at: preAuthorized ? now : null,
      adc_authorized_by: preAuthorized ? user.id : null,
      created_at: now,
    });

  if (error) throw new Error(`Error al crear solicitud: ${error.message} (code: ${error.code})`);

  // Push al ADC solo si quedó pendiente de autorización.
  if (!preAuthorized) notifyAuthorizers('material', { tenantId, code: requestId, requesterName: supervisorName });
}


export async function addAndApproveMaterialRequest(
  requestData: {
    items: { materialId: string; quantity: number }[];
    area: string;
    contractId?: string | null;
    contractName?: string | null;
    supervisorId: string;
    contractUrl?: string | null;
    internalCode?: string;
    /** Pañol desde el que se entrega (scope del panolero). */
    warehouseId?: string | null;
  },
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  // 1. Fetch materials and build updates
  const updates = [];
  let highestClass: 'A' | 'B' | 'C' = 'C';
  const classOrder = { 'A': 3, 'B': 2, 'C': 1 };

  for (const item of requestData.items) {
    const { data: mat } = await supabase.from('materials').select('*').eq('id', item.materialId).single();
    if (!mat) throw new Error(`Material ${item.materialId} no existe.`);
    if (mat.stock < item.quantity) throw new Error(`Stock insuficiente para ${mat.name}.`);

    const itemClass = (mat.class as 'A' | 'B' | 'C') || 'C';
    if (classOrder[itemClass] > classOrder[highestClass]) highestClass = itemClass;

    const newStock = (mat.stock || 0) - item.quantity;
    const newInUse = (mat.in_use || 0) + (mat.usage_type !== 'Consumible' ? item.quantity : 0);
    let newStatus = mat.status;
    if (mat.usage_type !== 'Consumible') {
      if (newInUse > 0) newStatus = 'En Uso';
      else if (newStock > 0) newStatus = 'Disponible';
    }

    updates.push({ item, mat, newStock, newInUse, newStatus });
  }

  // 2. IDs and Names
  const requestId = requestData.internalCode || await nextInternalCode(tenantId, 'TX');
  const { data: s } = await supabase.from('profiles').select('name').eq('id', requestData.supervisorId).single();
  const supervisorName = s?.name || 'Usuario';
  const now = new Date().toISOString();

  // 3. Perform Insert and Updates
  const { error: reqErr } = await supabase.from('material_requests').insert({
    internal_code: requestId,
    items: requestData.items,
    area: requestData.area,
    contract_id: requestData.contractId || null,
    contract_name: requestData.contractName || null,
    supervisor_id: requestData.supervisorId,
    supervisor_name: supervisorName,
    highest_class: highestClass,
    status: 'approved',
    tenant_id: tenantId,
    approval_date: now,
    delivery_date: now,
    approver_id: user.id,
    approver_name: user.name,
    // Aprobación directa de oficina ⇒ ya pasó la autorización ADC.
    adc_authorized_at: now,
    adc_authorized_by: user.id,
    contract_url: requestData.contractUrl || null,
    created_at: now
  });
  if (reqErr) throw reqErr;

  const contractId = requestData.contractId ?? null;
  const warehouseId = requestData.warehouseId ?? null;
  for (const u of updates) {
    await supabase.from('materials').update({ stock: u.newStock, in_use: u.newInUse, status: u.newStatus }).eq('id', u.mat.id);
    // Descuenta del desglose del contrato (cascada a pool central si no alcanza),
    // prefiriendo las existencias del pañol que entrega.
    const sources = await consumeFromLedger({ tenantId, materialId: u.mat.id, contractId, warehouseId, qty: u.item.quantity });
    const fallbackNote = await describeConsumeSources(sources, contractId);
    await supabase.from('stock_movements').insert({
      material_id: u.mat.id,
      material_name: u.mat.name,
      quantity_change: -u.item.quantity,
      new_stock: u.newStock,
      type: 'request-delivery',
      date: now,
      justification: `Entrega inmediata en Pañol (TX: ${requestId})${fallbackNote ? ` — ${fallbackNote}` : ''}`,
      user_id: requestData.supervisorId,
      user_name: supervisorName,
      related_request_id: requestId,
      contract_id: contractId,
      contract_name: requestData.contractName || null,
      warehouse_id: warehouseId,
      tenant_id: tenantId,
    });
  }
}

/**
 * Autorización del Administrador de Contratos (ADC): habilita la solicitud para
 * que el pañol/Abastecimiento la procese. No cambia el `status` (sigue 'pending')
 * — solo levanta el gate `adc_authorized_at`.
 */
export async function authorizeMaterialRequest(requestId: string, context: Context) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!userCan(user, 'material_requests:authorize'))
    throw new Error('No tienes permiso para autorizar solicitudes de material.');

  const { error } = await supabase
    .from('material_requests')
    .update({ adc_authorized_at: new Date().toISOString(), adc_authorized_by: user.id })
    .eq('id', requestId)
    .eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function updateMaterialRequestStatus(
  requestId: string,
  status: 'approved' | 'rejected',
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: request, error: fetchErr } = await supabase
    .from('material_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (fetchErr || !request) throw new Error("La solicitud no existe.");
  if (request.tenant_id !== tenantId) throw new Error("No tienes permiso para modificar esta solicitud.");

  const now = new Date().toISOString();

  if (status === 'approved') {
    const userRole = user.role as UserRole;
    const requiredPermissionsForRole = ROLES[userRole]?.permissions || [];
    const highestClass = request.highest_class || 'C';

    const canApproveA = requiredPermissionsForRole.includes('material_requests:approve_class_a');
    const canApproveB = requiredPermissionsForRole.includes('material_requests:approve_class_b');
    const canApproveC = requiredPermissionsForRole.includes('material_requests:approve_class_c');

    let hasPermission = false;
    switch (highestClass) {
      case 'A': hasPermission = canApproveA; break;
      case 'B': hasPermission = canApproveB || canApproveA; break;
      case 'C': hasPermission = canApproveC || canApproveB || canApproveA; break;
    }

    if (!hasPermission) throw new Error(`No tienes permiso para aprobar solicitudes de Clase ${highestClass}.`);

    // Check stock
    const updates = [];
    for (const item of request.items) {
      const { data: mat } = await supabase.from('materials').select('*').eq('id', item.materialId).single();
      if (!mat) throw new Error(`Material ${item.materialId} no existe.`);
      if (mat.stock < item.quantity) throw new Error(`Stock insuficiente para ${mat.name}.`);

      const newStock = (mat.stock || 0) - item.quantity;
      const newInUse = (mat.in_use || 0) + (mat.usage_type !== 'Consumible' ? item.quantity : 0);
      let newStatus = mat.status;
      if (mat.usage_type !== 'Consumible') {
        if (newInUse > 0) newStatus = 'En Uso';
        else if (newStock > 0) newStatus = 'Disponible';
      }
      updates.push({ item, mat, newStock, newInUse, newStatus });
    }

    // Apply updates
    const contractId = request.contract_id ?? null;
    for (const u of updates) {
      await supabase.from('materials').update({ stock: u.newStock, in_use: u.newInUse, status: u.newStatus }).eq('id', u.mat.id);
      // Descuenta del desglose del contrato de la solicitud (cascada a pool central).
      const sources = await consumeFromLedger({ tenantId, materialId: u.mat.id, contractId, qty: u.item.quantity });
      const fallbackNote = await describeConsumeSources(sources, contractId);
      await supabase.from('stock_movements').insert({
        material_id: u.mat.id,
        material_name: u.mat.name,
        quantity_change: -u.item.quantity,
        new_stock: u.newStock,
        type: 'request-delivery',
        date: now,
        justification: `Entrega para solicitud ${request.internal_code}${fallbackNote ? ` — ${fallbackNote}` : ''}`,
        user_id: request.supervisor_id,
        user_name: request.supervisor_name,
        related_request_id: requestId,
        contract_id: contractId,
        contract_name: request.contract_name || null,
        tenant_id: tenantId,
      });
    }

    await supabase.from('material_requests').update({
      status: 'approved',
      approval_date: now,
      approver_id: user.id,
      approver_name: user.name,
    }).eq('id', requestId);

  } else {
    await supabase.from('material_requests').update({
      status: 'rejected',
      rejection_date: now,
      approver_id: user.id,
      approver_name: user.name,
    }).eq('id', requestId);
  }
}

export async function deliverApprovedMaterialRequest(
  requestId: string,
  contractUrl: string | null,
  context: Context
) {
  const { user } = context;
  if (!user) throw new Error("No autenticado.");

  const { error } = await supabase
    .from('material_requests')
    .update({
      delivery_date: new Date().toISOString(),
      contract_url: contractUrl || null,
      delivered_by_user_id: user.id,
      delivered_by_user_name: user.name,
    })
    .eq('id', requestId)
    .eq('status', 'approved');

  if (error) throw error;
}

export async function addReturnRequest(
  items: { materialId: string; quantity: number; materialName: string; unit: string }[],
  notes: string,
  contract: { contractId?: string | null; contractName?: string | null } | undefined,
  { user, tenantId }: Context
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  for (const item of items) {
    const requestId = await nextInternalCode(tenantId, 'RET');

    await supabase.from('return_requests').insert({
      internal_code: requestId,
      supervisor_id: user.id,
      supervisor_name: user.name,
      material_id: item.materialId,
      material_name: item.materialName,
      quantity: item.quantity,
      unit: item.unit,
      status: 'pending',
      notes: notes || '',
      contract_id: contract?.contractId || null,
      contract_name: contract?.contractName || null,
      tenant_id: tenantId,
      created_at: new Date().toISOString()
    });
  }
}

export async function addAndCompleteReturnRequest(
  data: {
    items: {
      materialId: string;
      quantity: number;
      materialName: string;
      unit: string;
      condition: 'OK' | 'CON FALLA' | 'ROTO';
      notes?: string;
      evidenceUrl?: string;
    }[];
    notes: string;
    workerId: string;
    workerName: string;
    evidenceUrl?: string;
    contractId?: string | null;
    contractName?: string | null;
    /** Pañol que recibe la devolución (scope del panolero). */
    warehouseId?: string | null;
  },
  { user: handler, tenantId }: Context
) {
  if (!handler || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const now = new Date().toISOString();

  for (const item of data.items) {
    const requestId = await nextInternalCode(tenantId, 'RET');

    const { error: insertError } = await supabase.from('return_requests').insert({
      internal_code: requestId,
      supervisor_id: data.workerId,
      supervisor_name: data.workerName,
      material_id: item.materialId,
      material_name: item.materialName,
      quantity: item.quantity,
      unit: item.unit,
      status: 'completed',
      completion_date: now,
      notes: item.notes || data.notes || '',
      tenant_id: tenantId,
      handler_id: handler.id,
      handler_name: handler.name,
      return_condition: item.condition,
      evidence_url: item.evidenceUrl || data.evidenceUrl || null,
      contract_id: data.contractId || null,
      contract_name: data.contractName || null,
      created_at: now,
      items: [{ materialId: item.materialId, quantity: item.quantity, condition: item.condition }],
    });

    if (insertError) throw new Error(`Error al registrar devolución: ${insertError.message}`);

    const { data: mat } = await supabase.from('materials').select('*').eq('id', item.materialId).single();
    if (mat) {
      const newStock = (mat.stock || 0) + item.quantity;
      const newInUse = Math.max(0, (mat.in_use || 0) - item.quantity);
      let newStatus = mat.status;
      if (mat.usage_type !== 'Consumible') {
        if (item.condition !== 'OK') newStatus = 'En Mantenimiento';
        else if (newInUse > 0) newStatus = 'En Uso';
        else newStatus = 'Disponible';
      }
      await supabase.from('materials').update({ stock: newStock, in_use: newInUse, status: newStatus }).eq('id', mat.id);

      // Reingresa al desglose del contrato indicado (o pool central), en el pañol que recibe.
      await addToLedger({
        tenantId,
        materialId: item.materialId,
        contractId: data.contractId ?? null,
        warehouseId: data.warehouseId ?? null,
        qty: item.quantity,
      });

      await supabase.from('stock_movements').insert({
        material_id: item.materialId,
        material_name: item.materialName,
        quantity_change: item.quantity,
        new_stock: newStock,
        type: 'return-reentry',
        date: now,
        justification: `Devolución inmediata en Pañol (TX: ${requestId})`,
        user_id: data.workerId,
        user_name: data.workerName,
        related_request_id: requestId,
        contract_id: data.contractId || null,
        contract_name: data.contractName || null,
        warehouse_id: data.warehouseId ?? null,
        tenant_id: tenantId,
      });
    }
  }
}

export async function updateReturnRequestStatus(
  requestId: string,
  status: 'completed' | 'rejected',
  additionalData: { condition: 'OK' | 'CON FALLA' | 'ROTO', evidenceUrl?: string } | undefined,
  { user, tenantId }: Context,
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: returnReq, error: fetchErr } = await supabase.from('return_requests').select('*').eq('id', requestId).single();
  if (fetchErr || !returnReq) throw new Error("La solicitud de devolución no existe.");

  const now = new Date().toISOString();

  if (status === 'completed') {
    const { data: mat } = await supabase.from('materials').select('*').eq('id', returnReq.material_id).single();
    if (mat) {
      const newStock = (mat.stock || 0) + returnReq.quantity;
      const newInUse = Math.max(0, (mat.in_use || 0) - returnReq.quantity);
      let newStatus = mat.status;
      if (mat.usage_type !== 'Consumible') {
        if (additionalData?.condition !== 'OK') newStatus = 'En Mantenimiento';
        else if (newInUse > 0) newStatus = 'En Uso';
        else newStatus = 'Disponible';
      }
      await supabase.from('materials').update({ stock: newStock, in_use: newInUse, status: newStatus }).eq('id', mat.id);

      // Reingresa al desglose del contrato registrado en la devolución (o pool central).
      await addToLedger({ tenantId, materialId: returnReq.material_id, contractId: returnReq.contract_id ?? null, qty: returnReq.quantity });

      await supabase.from('stock_movements').insert({
        material_id: returnReq.material_id,
        material_name: returnReq.material_name,
        quantity_change: returnReq.quantity,
        new_stock: newStock,
        type: 'return-reentry',
        date: now,
        justification: `Devolución de solicitud ${returnReq.internal_code}`,
        user_id: returnReq.supervisor_id,
        user_name: returnReq.supervisor_name,
        related_request_id: requestId,
        contract_id: returnReq.contract_id || null,
        contract_name: returnReq.contract_name || null,
        tenant_id: tenantId,
      });
    }
  }

  await supabase.from('return_requests').update({
    status: status,
    completion_date: now,
    handler_id: user.id,
    handler_name: user.name,
    return_condition: additionalData?.condition,
    evidence_url: additionalData?.evidenceUrl || null
  }).eq('id', requestId);
}

export async function deleteMaterialRequest(requestId: string, { user, tenantId }: Context) {
  const { error } = await supabase.from('material_requests').delete().eq('id', requestId);
  if (error) throw error;
}

export async function deleteReturnRequest(requestId: string, { user, tenantId }: Context) {
  const { error } = await supabase.from('return_requests').delete().eq('id', requestId);
  if (error) throw error;
}
