

import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers, notifyWithdrawal } from '@/modules/core/lib/notify-authorizers';
import type { ConsumeSource } from './stockLedger';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { consumptionTransfers } from './financeMath';
import { highestClassOf, canApproveClass, type RequestClass } from './requestClassMath';
import { openCorrectiveOrderForReturn } from './maintenanceMutations';

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

// ─────────────────────────────────────────────────────────────────────────────
// Aprobar, anular, devolver y entregar en ventanilla corren como UNA transacción en la base (migración
// 20261030000000: funciones `approve_material_request`, `cancel_approved_material_request`,
// `complete_return_request`, `deliver_directly` y `return_directly`), con las filas bloqueadas: o queda todo o
// no queda nada, y dos personas a la vez no se pisan. Lo que sigue siendo de la aplicación está aquí: validar
// los permisos ANTES (`can()` respeta los roles propios de cada empresa y no existe en SQL), los avisos, el costo
// en finanzas y la OT de un equipo con falla.
// ─────────────────────────────────────────────────────────────────────────────

type Item = { materialId: string; quantity: number };

/** Junta las líneas repetidas de un mismo material (antes la segunda pisaba a la primera). */
function mergeItems(items: Item[] | null | undefined): Item[] {
  const totals = new Map<string, number>();
  for (const it of items || []) {
    const q = Number(it.quantity);
    if (!(q > 0)) throw new Error('Las cantidades deben ser mayores que cero.');
    totals.set(it.materialId, (totals.get(it.materialId) || 0) + q);
  }
  return [...totals].map(([materialId, quantity]) => ({ materialId, quantity }));
}

async function loadMaterials(tenantId: string, ids: string[]): Promise<Map<string, any>> {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from('materials').select('*').eq('tenant_id', tenantId).in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((m: any) => [m.id, m]));
}

const isAssetRow = (mat: any) => mat.usage_type !== 'Consumible';

/** El costo de lo consumido pasa a finanzas DESPUÉS de que el despacho quedó firme. */
async function emitConsumption(
  applied: { mat: any; sources: ConsumeSource[] }[],
  p: { contractId: string | null; contractName: string | null; requestCode: string },
  context: Context,
) {
  try {
    for (const a of applied) {
      await emitConsumptionForDelivery({ mat: a.mat, sources: a.sources, contractId: p.contractId, contractName: p.contractName, requestCode: p.requestCode }, context);
    }
  } catch (e: any) {
    console.error('[retiros] no se pudo registrar el costo en finanzas', p.requestCode, e);
    throw new Error(`El despacho quedó aprobado, pero no se pudo registrar su costo en finanzas (${e?.message || 'error'}). Avisa a soporte.`);
  }
}

interface RestockLine { materialId: string; quantity: number; condition?: 'OK' | 'CON FALLA' | 'ROTO' }

/**
 * Un equipo que vuelve con falla queda «En Mantenimiento»: ahora además se abre su OT correctiva, para que
 * alguien tenga la tarea de arreglarlo (antes el equipo quedaba en ese estado sin OT y sin salida). Si la
 * OT no se puede crear, la devolución igual quedó hecha: se deja constancia y el equipo sigue en
 * mantenimiento como antes.
 */
async function openOrdersForFailedReturns(
  restocked: { mat: any; line: RestockLine }[],
  p: { tenantId: string; code: string; notes?: string | null; reportedBy: string },
): Promise<void> {
  for (const { mat, line } of restocked) {
    if (!isAssetRow(mat) || line.condition === 'OK') continue;
    try {
      await openCorrectiveOrderForReturn({
        tenantId: p.tenantId,
        materialId: mat.id,
        materialName: mat.name,
        description: `Devolución ${p.code} ${line.condition === 'ROTO' ? 'con el equipo roto' : 'con falla'}${p.notes ? `: ${p.notes}` : ''}`,
        priority: line.condition === 'ROTO' ? 'HIGH' : 'MEDIUM',
        reportedBy: p.reportedBy,
      });
    } catch (e) {
      console.error('[devoluciones] no se pudo abrir la OT de un equipo con falla', mat.id, e);
    }
  }
}

// ── Llamada a las funciones atómicas de la base ──────────────────────────────

interface RpcItem { material_id: string; name: string; usage_type: string | null; unit_cost: number | null; class: string; qty: number; sources: { contract_id: string | null; qty: number }[] }

const isMissingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|no function matches/i.test(e.message || ''));

/**
 * Llama a una función de la base. El error de negocio llega tal cual (está escrito en español para la
 * persona). Si la función no existe es que falta aplicar la migración: se dice claro, en vez de seguir por un
 * camino no atómico a escondidas.
 */
async function viaRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isMissingFunction(error)) {
      throw new Error('Falta aplicar la migración 20261030000000_atomic_withdrawals en la base: sin ella no se puede aprobar, anular, devolver ni entregar.');
    }
    throw new Error(error.message);
  }
  return data as T;
}

const toApplied = (items: RpcItem[]) => items.map(i => ({
  mat: { id: i.material_id, name: i.name, usage_type: i.usage_type, unit_cost: i.unit_cost },
  sources: (i.sources || []).map(x => ({ contractId: x.contract_id, qty: Number(x.qty) })),
}));

/** Clase real de lo pedido, calculada de los materiales (la guardada puede venir mal de antes). */
async function realClassOf(items: Item[], tenantId: string): Promise<RequestClass> {
  const mats = await loadMaterials(tenantId, items.map(i => i.materialId));
  return highestClassOf(items.map(i => mats.get(i.materialId)?.criticality));
}

export async function addMaterialRequest(
  requestData: {
    items: { materialId: string; quantity: number }[];
    area: string;
    contractId?: string | null;
    contractName?: string | null;
    supervisorId: string;
    supervisorName?: string;
    /** @deprecated Se ignora: la clase se calcula de los materiales pedidos. */
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

  const deliveryMode = requestData.deliveryMode || 'self';
  if (deliveryMode === 'directed' && !requestData.beneficiaryId)
    throw new Error('Una solicitud dirigida requiere un trabajador destinatario.');

  const items = mergeItems(requestData.items);
  if (!items.length) throw new Error('Debes pedir al menos un material.');
  // La clase es un hecho de los materiales pedidos. Antes valía lo que mandara la pantalla y, si
  // no mandaba nada, 'A': todo retiro de faena nacía clase A y el pañolero no podía aprobarlo.
  const mats = await loadMaterials(tenantId, items.map(i => i.materialId));
  for (const it of items) if (!mats.has(it.materialId)) throw new Error(`Material ${it.materialId} no existe.`);
  const highestClass = highestClassOf(items.map(i => mats.get(i.materialId)?.criticality));

  const requestId = await nextInternalCode(tenantId, 'TX');

  // Si quien crea ya puede autorizar (ADC o superior), la solicitud entra
  // pre-autorizada y salta el gate del ADC, directo a la cola del pañol.
  const preAuthorized = can('material_requests:authorize');
  const now = new Date().toISOString();

  const { data: created, error } = await supabase
    .from('material_requests')
    .insert({
      internal_code: requestId,
      items,
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
    })
    .select('id, adc_authorized_at')
    .single();

  if (error) throw new Error(`Error al crear solicitud: ${error.message} (code: ${error.code})`);

  // Push a quien autoriza sólo si quedó pendiente. RFC-006 F5: con la firma por
  // valor, la base saca la pre-autorización si quien crea no es el firmante que
  // corresponde — por eso se mira lo que quedó guardado, no lo que se pidió.
  if (!created?.adc_authorized_at) notifyAuthorizers('material', { tenantId, code: requestId, requesterName: supervisorName });
  // Si entró pre-autorizada, se salta al ADC: el aviso va directo al pañol.
  else if (created?.id) notifyWithdrawal('authorized', created.id);
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
    /**
     * Retiro con revisión posterior (empresa en modo 'post'): se entrega en el
     * acto y queda pendiente de que el supervisor revise línea por línea. La
     * clase A nunca entra por acá: sigue pidiendo aprobación previa.
     */
    requiresReview?: boolean;
  },
  context: Context
) {
  const { user, tenantId } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');

  // Defensa en la mutación, no sólo en la pantalla: sin aprobación previa no
  // sale clase A nunca, ni clase B si el retiro no queda con revisión posterior.
  const maxDirectClass: 'B' | 'C' = requestData.requiresReview ? 'B' : 'C';

  const items = mergeItems(requestData.items);
  if (!items.length) throw new Error('Debes indicar al menos un material.');
  const requestId = requestData.internalCode || await nextInternalCode(tenantId, 'TX');

  // El retiro entregado, el descuento, el desglose y el kardex quedan en UNA transacción (la clase y el stock se
  // validan adentro: o se entrega todo o no queda nada).
  const delivered = await viaRpc<{ items: RpcItem[] }>('deliver_directly', {
    p_code: requestId, p_items: items, p_area: requestData.area, p_contract_id: requestData.contractId ?? null,
    p_contract_name: requestData.contractName || null, p_supervisor: requestData.supervisorId, p_warehouse: requestData.warehouseId ?? null,
    p_contract_url: requestData.contractUrl || null, p_requires_review: !!requestData.requiresReview, p_max_class: maxDirectClass,
  });
  await emitConsumption(toApplied(delivered.items),
    { contractId: requestData.contractId ?? null, contractName: requestData.contractName || null, requestCode: requestId }, context);
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

  // `.select()`: un UPDATE que la RLS o un filtro dejan en 0 filas no lanza error, y antes
  // «autorizado» se mostraba igual sin que nada hubiera cambiado.
  const { data, error } = await supabase
    .from('material_requests')
    .update({ adc_authorized_at: new Date().toISOString(), adc_authorized_by: user.id })
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .is('adc_authorized_at', null)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Esta solicitud ya fue autorizada, o ya no está pendiente.');

  // Ahora le toca al pañol: sin este aviso nadie sabía que había un retiro esperando.
  notifyWithdrawal('authorized', requestId);
}

export async function updateMaterialRequestStatus(
  requestId: string,
  status: 'approved' | 'rejected',
  context: Context
) {
  return processRequest(requestId, status, null, context);
}

/**
 * Rechaza un retiro dejando el MOTIVO donde lo ve quien lo pidió (en `notes`, que la tarjeta del
 * solicitante muestra). Antes se rechazaba en silencio: el solicitante veía «Rechazada» sin saber por qué.
 * `reason` va siempre (puede ser ''): `bindContext` agrega el contexto al final, así que un parámetro
 * opcional antes del contexto lo recibiría el contexto.
 */
export async function rejectMaterialRequest(requestId: string, reason: string, context: Context) {
  return processRequest(requestId, 'rejected', (reason || '').trim() || null, context);
}

async function processRequest(
  requestId: string,
  status: 'approved' | 'rejected',
  reason: string | null,
  context: Context
) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: request, error: fetchErr } = await supabase
    .from('material_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchErr || !request) throw new Error("La solicitud no existe.");
  if (request.tenant_id !== tenantId) throw new Error("No tienes permiso para modificar esta solicitud.");
  // Sin esta guarda, aprobar dos veces (dos pañoleros, un doble clic, una lista vieja) descontaba
  // el stock dos veces.
  if (request.status !== 'pending') {
    throw new Error(`Esta solicitud ya fue ${request.status === 'approved' ? 'aprobada' : 'rechazada'}.`);
  }

  const items = mergeItems(request.items);
  // La clase REAL sale de los materiales: la guardada puede venir mal de cuando todo nacía clase A.
  const realClass = await realClassOf(items, tenantId);
  const now = new Date().toISOString();

  if (status === 'approved') {
    // Gate ADC: una solicitud no puede aprobarse en el pañol si el Administrador
    // de Contrato no la autorizó primero (o el creador no venía pre-autorizado).
    // El filtro de la UI ya lo respeta; esto lo refuerza en el servidor.
    if (!request.adc_authorized_at) {
      throw new Error('Esta solicitud aún no ha sido autorizada por el ADC. No puede aprobarse en el pañol.');
    }
    // Mismos permisos que ve la pantalla (`can()`): antes se miraba la tabla fija de roles y un rol
    // con permisos propios de su empresa veía el botón y recibía un rechazo.
    if (!canApproveClass(can, realClass)) throw new Error(`No tienes permiso para aprobar solicitudes de Clase ${realClass}.`);

    // El retiro, la ficha, el desglose y el kardex quedan en UNA transacción en la base.
    const approved = await viaRpc<{ code: string | null; contract_id: string | null; contract_name: string | null; items: RpcItem[] }>(
      'approve_material_request', { p_request: requestId });
    // El solicitante ya puede ir a retirarlo.
    notifyWithdrawal('approved', requestId);
    await emitConsumption(toApplied(approved.items),
      { contractId: approved.contract_id, contractName: approved.contract_name, requestCode: approved.code || request.internal_code || requestId }, context);
  } else {
    // Quien puede aprobar la clase puede rechazarla; el ADC también (rechaza lo que no autoriza).
    if (!canApproveClass(can, realClass) && !can('material_requests:authorize')) {
      throw new Error('No tienes permiso para rechazar esta solicitud.');
    }
    const { data: claimed, error } = await supabase.from('material_requests').update({
      status: 'rejected',
      rejection_date: now,
      approver_id: user.id,
      approver_name: user.name,
      ...(reason ? { notes: [request.notes, `Motivo del rechazo: ${reason}`].filter(Boolean).join(' · ') } : {}),
    }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'pending').select('id');
    if (error) throw error;
    if (!claimed?.length) throw new Error('Esta solicitud ya fue procesada por otra persona.');
  }
}

/**
 * Deshace un despacho APROBADO que todavía nadie retiró: devuelve el stock, `in_use`, el desglose y
 * el costo, y el retiro vuelve a «por aprobar» (sigue autorizado por el ADC). Antes no había forma:
 * aprobar saca el stock del inventario y, si el trabajador no venía, el activo quedaba perdido
 * —sin estar en el pañol ni en manos de nadie— hasta que alguien lo arreglara en la base.
 */
export async function cancelApprovedMaterialRequest(requestId: string, reason: string, context: Context) {
  const { user, tenantId, can } = context;
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  const why = (reason || '').trim();
  if (!why) throw new Error('Indica el motivo de la anulación.');

  const { data: request, error: fetchErr } = await supabase.from('material_requests').select('*').eq('id', requestId).maybeSingle();
  if (fetchErr || !request) throw new Error('La solicitud no existe.');
  if (request.tenant_id !== tenantId) throw new Error('No tienes permiso para modificar esta solicitud.');
  if (request.delivery_date) throw new Error('Este despacho ya fue entregado: no se puede anular. Si el trabajador lo devuelve, regístralo como devolución.');
  if (request.status !== 'approved') throw new Error('Sólo se puede anular un despacho que está aprobado.');

  const items = mergeItems(request.items);
  const realClass = await realClassOf(items, tenantId);
  if (!canApproveClass(can, realClass) && !can('material_requests:authorize')) {
    throw new Error('No tienes permiso para anular este despacho.');
  }

  // La devolución del stock y el retorno del retiro a «por aprobar», en UNA transacción en la base.
  const cancelled = await viaRpc<{ code: string | null }>('cancel_approved_material_request', { p_request: requestId, p_reason: why });
  const code = cancelled.code || request.internal_code || requestId;
  notifyWithdrawal('cancelled', requestId);
  try {
    // El consumo del costo se había emitido al aprobar: la anulación lo reversa (hechos inmutables).
    await reverseEntriesForSource('material_request', code, `Anulación de despacho: ${why}`, context);
  } catch (e: any) {
    console.error('[retiros] no se pudo reversar el costo de un despacho anulado', code, e);
    throw new Error(`El despacho se anuló y el stock volvió, pero no se pudo reversar su costo en finanzas (${e?.message || 'error'}). Avisa a soporte.`);
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
  verification: { mode: 'biometric' | 'exception' | 'rut' | 'pin'; exceptionGroupId?: string | null } | null,
  context: Context,
) {
  const { user } = context;
  if (!user) throw new Error("No autenticado.");

  // `.is('delivery_date', null)` + `.select()`: una segunda entrega ya no pisa a la primera (quién
  // recibió, con qué verificación), y un retiro que no está aprobado deja de «entregarse» en vacío.
  const { data, error } = await supabase
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
    .eq('status', 'approved')
    .is('delivery_date', null)
    .select('id');

  if (error) throw error;
  if (!data?.length) throw new Error('Este retiro no está aprobado o ya fue entregado.');
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

  for (const item of data.items) {
    const requestId = await nextInternalCode(tenantId, 'RET');

    // La devolución y el reingreso (ficha, desglose, kardex) en UNA transacción en la base: si el reingreso falla,
    // no queda una devolución «completada» que no sumó nada.
    const direct = await viaRpc<{ restocked: { material_id: string; name: string; usage_type: string | null } }>('return_directly', {
      p_code: requestId, p_material: item.materialId, p_quantity: item.quantity, p_material_name: item.materialName, p_unit: item.unit,
      p_condition: item.condition, p_notes: item.notes || data.notes || '', p_evidence: item.evidenceUrl || data.evidenceUrl || null,
      p_worker: data.workerId, p_worker_name: data.workerName, p_contract_id: data.contractId ?? null, p_contract_name: data.contractName || null,
      p_warehouse: data.warehouseId ?? null,
    });
    const r = direct.restocked;
    await openOrdersForFailedReturns(
      [{ mat: { id: r.material_id, name: r.name, usage_type: r.usage_type }, line: { materialId: item.materialId, quantity: item.quantity, condition: item.condition } }],
      { tenantId, code: requestId, notes: item.notes || data.notes, reportedBy: handler.name });
  }
}

export async function updateReturnRequestStatus(
  requestId: string,
  status: 'completed' | 'rejected',
  additionalData: { condition: 'OK' | 'CON FALLA' | 'ROTO', evidenceUrl?: string } | undefined,
  { user, tenantId, can }: Context,
) {
  if (!user || !tenantId) throw new Error("No autenticado o sin inquilino.");

  const { data: returnReq, error: fetchErr } = await supabase.from('return_requests').select('*').eq('id', requestId).maybeSingle();
  if (fetchErr || !returnReq) throw new Error("La solicitud de devolución no existe.");
  // Antes no se miraba la empresa ni el estado: completar dos veces sumaba el stock dos veces.
  if (returnReq.tenant_id !== tenantId) throw new Error("No tienes permiso para modificar esta devolución.");
  if (!can('return_requests:approve')) throw new Error('No tienes permiso para resolver devoluciones.');
  if (returnReq.status !== 'pending') {
    throw new Error(`Esta devolución ya fue ${returnReq.status === 'completed' ? 'completada' : 'rechazada'}.`);
  }

  // El estado de la devolución y el reingreso (ficha, desglose, kardex) en UNA transacción en la base.
  const resolved = await viaRpc<{ code: string | null; notes: string | null; restocked: { material_id: string; name: string; usage_type: string | null; condition: string | null } | null }>(
    'complete_return_request',
    { p_return: requestId, p_status: status, p_condition: additionalData?.condition ?? null, p_evidence: additionalData?.evidenceUrl ?? null });
  if (status === 'completed' && resolved.restocked) {
    const r = resolved.restocked;
    await openOrdersForFailedReturns(
      [{ mat: { id: r.material_id, name: r.name, usage_type: r.usage_type }, line: { materialId: r.material_id, quantity: returnReq.quantity, condition: additionalData?.condition as RestockLine['condition'] } }],
      { tenantId, code: resolved.code || returnReq.internal_code || requestId, notes: resolved.notes ?? returnReq.notes, reportedBy: user.name });
  }
}

// Borrado de solicitudes: sólo super-admin, y no mientras el stock de un despacho aprobado siga
// afuera (borrar la fila lo dejaría descontado para siempre, sin nadie que lo tenga).
export async function deleteMaterialRequest(requestId: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (user.role !== 'super-admin') throw new Error('Sólo un super-admin puede eliminar solicitudes.');
  const { data: r } = await supabase.from('material_requests').select('status, delivery_date').eq('id', requestId).eq('tenant_id', tenantId).maybeSingle();
  if (r?.status === 'approved' && !r.delivery_date) {
    throw new Error('Este despacho está aprobado y su stock ya salió del inventario: anúlalo primero.');
  }
  const { error } = await supabase.from('material_requests').delete().eq('id', requestId).eq('tenant_id', tenantId);
  if (error) throw error;
}

export async function deleteReturnRequest(requestId: string, { user, tenantId }: Context) {
  if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
  if (user.role !== 'super-admin') throw new Error('Sólo un super-admin puede eliminar devoluciones.');
  const { error } = await supabase.from('return_requests').delete().eq('id', requestId).eq('tenant_id', tenantId);
  if (error) throw error;
}
