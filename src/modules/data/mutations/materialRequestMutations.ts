

import { supabase } from '@/modules/core/lib/supabase';
import { MaterialRequest, Material, ReturnRequest, UserRole } from '@/modules/core/lib/data';
import { ROLES, Permission, userCan } from '@/modules/core/lib/permissions';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers } from '@/modules/core/lib/notify-authorizers';
import { addToLedger, consumeFromLedger, describeConsumeSources, type ConsumeSource } from './stockLedger';
import { emitFinanceEntries } from './financeLedger';
import { consumptionTransfers } from './financeMath';

import type { MutationContext as Context } from './context';

/**
 * Emisor F2 (ADR-004 §7-8): la entrega de un CONSUMIBLE a un contrato mueve el
 * costo de la dimensión de la que salieron las unidades (pool = "Sin contrato",
 * u otro contrato en cascada) hacia el contrato destino. Lo que ya estaba en el
 * destino no re-emite (la recepción ya lo devengó ahí: una unidad nunca costea
 * dos veces). Herramientas/activos se PRESTAN, no se consumen: no emiten.
 */
async function emitConsumptionForDelivery(
  opts: {
    mat: { id: string; name: string; usage_type?: string | null; unit_cost?: number | null };
    sources: ConsumeSource[];
    contractId: string | null;
    contractName: string | null;
    requestCode: string;
  },
  context: Context,
): Promise<void> {
  if (opts.mat.usage_type !== 'Consumible') return;
  const moves = consumptionTransfers(opts.sources, opts.contractId, Number(opts.mat.unit_cost) || 0);
  if (!moves.length) return;

  // Nombres de los contratos involucrados (snapshot en el hecho).
  const ids = [...new Set(moves.map((m) => m.contractId).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from('contracts').select('id, name').in('id', ids);
    for (const c of data || []) names.set(c.id, c.name);
  }
  if (opts.contractId && opts.contractName) names.set(opts.contractId, opts.contractName);

  await emitFinanceEntries(moves.map((m) => ({
    nature: 'cost' as const,
    stage: 'accrued' as const,
    category: 'materials' as const,
    amountNet: m.amountNet,
    contractId: m.contractId,
    contractName: m.contractId ? names.get(m.contractId) ?? null : null,
    sourceType: 'material_request',
    sourceId: opts.requestCode,
    sourceCode: opts.requestCode,
    counterpartyType: 'material',
    counterpartyId: opts.mat.id,
    counterpartyName: opts.mat.name,
    notes: `Consumo de pañol — ${opts.mat.name}`,
  })), context);
}

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
    /** Quién retira: 'self' (default) | 'directed' (beneficiary*) | 'open'. */
    deliveryMode?: 'self' | 'directed' | 'open';
    beneficiaryId?: string | null;
    beneficiaryName?: string | null;
  },
  context: Context
) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  const supervisorName = requestData.supervisorName || user.name || 'Usuario';
  const highestClass = requestData.highestClass || 'A';

  const deliveryMode = requestData.deliveryMode || 'self';
  if (deliveryMode === 'directed' && !requestData.beneficiaryId)
    throw new Error('Una solicitud dirigida requiere un trabajador destinatario.');

  const requestId = await nextInternalCode(tenantId, 'TX');

  // Si quien crea ya puede autorizar (ADC o superior), la solicitud entra
  // pre-autorizada y salta el gate del ADC, directo a la cola del pañol.
  const preAuthorized = can('material_requests:authorize');
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
      delivery_mode: deliveryMode,
      beneficiary_id: deliveryMode === 'directed' ? requestData.beneficiaryId : null,
      beneficiary_name: deliveryMode === 'directed' ? (requestData.beneficiaryName || null) : null,
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
    // Entrega inmediata: el trabajador identificado retira en el acto.
    delivery_mode: 'self',
    received_by_user_id: requestData.supervisorId,
    received_by_user_name: supervisorName,
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
    await emitConsumptionForDelivery({
      mat: u.mat,
      sources,
      contractId,
      contractName: requestData.contractName || null,
      requestCode: requestId,
    }, context);
  }
}

/**
 * Autorización del Administrador de Contratos (ADC): habilita la solicitud para
 * que el pañol/Abastecimiento la procese. No cambia el `status` (sigue 'pending')
 * — solo levanta el gate `adc_authorized_at`.
 */
export async function authorizeMaterialRequest(requestId: string, context: Context) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (!can('material_requests:authorize'))
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
    // Gate ADC: una solicitud no puede aprobarse en el pañol si el Administrador
    // de Contrato no la autorizó primero (o el creador no venía pre-autorizado).
    // El filtro de la UI ya lo respeta; esto lo refuerza en el servidor.
    if (!request.adc_authorized_at) {
      throw new Error('Esta solicitud aún no ha sido autorizada por el ADC. No puede aprobarse en el pañol.');
    }

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
      await emitConsumptionForDelivery({
        mat: u.mat,
        sources,
        contractId,
        contractName: request.contract_name || null,
        requestCode: request.internal_code || requestId,
      }, context);
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
  /** Receptor real verificado (biometría/QR) en el pañol. null = no informado. */
  receiver: { id: string; name: string } | null,
  /**
   * Cómo se acreditó la recepción. `exception` = salió SIN verificación facial,
   * con autorización de un ADC/Administrador. Se guarda acá además de en
   * `biometric_verifications` para que listar entregas no obligue a cruzar nada,
   * y para que el contrato de responsabilidad pueda imprimirlo.
   *
   * Va ANTES del contexto: `bindContext` inyecta el contexto como último
   * argumento, así que ningún parámetro puede ir después.
   */
  verification: { mode: 'biometric' | 'exception'; exceptionGroupId?: string | null } | null,
  context: Context,
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
      received_by_user_id: receiver?.id || null,
      received_by_user_name: receiver?.name || null,
      delivery_verification: verification?.mode ?? null,
      delivery_exception_id: verification?.exceptionGroupId ?? null,
    })
    .eq('id', requestId)
    .eq('status', 'approved');

  if (error) throw error;
}

// Custodio real de una solicitud aprobada: quien recibió (biometría/QR) >
// beneficiario dirigido > solicitante. Misma fórmula que computeToolHolderMap
// (tool-loans.ts) — para que "cuánto tengo pendiente de devolver" nunca
// contradiga "quién tiene este activo" en Activos/Reportes.
function holderOfRequest(r: { receivedByUserId?: string | null; deliveryMode?: string | null; beneficiaryId?: string | null; supervisorId: string }): string {
  return r.receivedByUserId || (r.deliveryMode === 'directed' ? r.beneficiaryId ?? null : null) || r.supervisorId;
}

const balanceKey = (materialId: string, contractId?: string | null) => `${materialId}::${contractId ?? 'pool'}`;

/**
 * Saldo pendiente de devolución de un usuario por (material, contrato):
 * suma de ítems tomados en solicitudes aprobadas donde es custodio, menos lo
 * que ya devolvió (pendiente o completado — rechazado no cuenta, no se
 * concretó). Se recalcula en el servidor SIEMPRE antes de insertar: la UI
 * puede mostrar un saldo optimista, pero nunca es la única barrera.
 */
async function computeReturnBalances(tenantId: string, userId: string): Promise<Map<string, number>> {
  const { data: approvedReqs, error: reqErr } = await supabase
    .from('material_requests')
    .select('items, contract_id, delivery_mode, beneficiary_id, received_by_user_id, supervisor_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'approved');
  if (reqErr) throw reqErr;

  const taken = new Map<string, number>();
  (approvedReqs || []).forEach((r: any) => {
    if (holderOfRequest({
      receivedByUserId: r.received_by_user_id,
      deliveryMode: r.delivery_mode,
      beneficiaryId: r.beneficiary_id,
      supervisorId: r.supervisor_id,
    }) !== userId) return;
    (r.items || []).forEach((item: any) => {
      const key = balanceKey(item.materialId, r.contract_id);
      taken.set(key, (taken.get(key) || 0) + (item.quantity || 0));
    });
  });

  const { data: existingReturns, error: retErr } = await supabase
    .from('return_requests')
    .select('material_id, contract_id, quantity, status')
    .eq('tenant_id', tenantId)
    .eq('supervisor_id', userId)
    .neq('status', 'rejected');
  if (retErr) throw retErr;

  const balances = new Map<string, number>(taken);
  (existingReturns || []).forEach((r: any) => {
    const key = balanceKey(r.material_id, r.contract_id);
    balances.set(key, (balances.get(key) || 0) - (r.quantity || 0));
  });
  return balances;
}

export async function addReturnRequest(
  items: { materialId: string; quantity: number; materialName: string; unit: string; contractId?: string | null; contractName?: string | null }[],
  notes: string,
  { user, tenantId, can }: Context
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");
  if (items.length === 0) throw new Error("Debes indicar al menos un ítem a devolver.");

  // Saldo pendiente REAL, recalculado en el servidor — bloquea la sobre-devolución
  // (devolver más de lo retirado, o devolver dos veces lo mismo) aunque la UI
  // se haya quedado con datos viejos.
  const balances = await computeReturnBalances(tenantId, user.id);
  for (const item of items) {
    const outstanding = balances.get(balanceKey(item.materialId, item.contractId)) || 0;
    if (item.quantity > outstanding) {
      throw new Error(`No puedes devolver ${item.quantity} ${item.unit} de ${item.materialName}: tu saldo pendiente es ${Math.max(outstanding, 0)}.`);
    }
  }

  const now = new Date().toISOString();
  for (const item of items) {
    const requestId = await nextInternalCode(tenantId, 'RET');
    const { error } = await supabase.from('return_requests').insert({
      internal_code: requestId,
      supervisor_id: user.id,
      supervisor_name: user.name,
      material_id: item.materialId,
      material_name: item.materialName,
      quantity: item.quantity,
      unit: item.unit,
      status: 'pending',
      notes: notes || '',
      contract_id: item.contractId || null,
      contract_name: item.contractName || null,
      tenant_id: tenantId,
      created_at: now,
      // `items` es NOT NULL en la tabla pero no existe en el tipo ReturnRequest
      // (columna heredada de un diseño multi-ítem anterior). Sin esto, TODO
      // insert de devolución fallaba en silencio (ver fix del error ignorado
      // más arriba) — nunca se había detectado porque nadie miraba el error.
      items: [{ materialId: item.materialId, quantity: item.quantity }],
    });
    // Antes esto no se revisaba: un insert fallido (RLS, red, constraint) dejaba
    // "Éxito" en la UI con cero filas guardadas — el material quedaba en el limbo.
    if (error) throw new Error(`Error al registrar devolución de ${item.materialName}: ${error.message}`);
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
  { user, tenantId, can }: Context,
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

export async function deleteMaterialRequest(requestId: string, { user, tenantId, can }: Context) {
  const { error } = await supabase.from('material_requests').delete().eq('id', requestId);
  if (error) throw error;
}

export async function deleteReturnRequest(requestId: string, { user, tenantId, can }: Context) {
  const { error } = await supabase.from('return_requests').delete().eq('id', requestId);
  if (error) throw error;
}
