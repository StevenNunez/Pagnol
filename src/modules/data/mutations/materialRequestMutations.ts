

import { supabase } from '@/modules/core/lib/supabase';
import { nextInternalCode } from '@/modules/core/lib/sequence-utils';
import { notifyAuthorizers, notifyWithdrawal } from '@/modules/core/lib/notify-authorizers';
import { addToLedger, consumeFromLedger, describeConsumeSources, type ConsumeSource } from './stockLedger';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { findCentralWarehouseId, placeForReturn } from './returnPlace';
import { isRastreable } from '@/lib/api/mappers';
import { consumptionTransfers } from './financeMath';
import { asClass, highestClassOf, canApproveClass, type RequestClass } from './requestClassMath';
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
// Descuento y reingreso de existencias — UN solo camino para los retiros y otro para los
// reingresos (antes eran cuatro copias de la misma cuenta, y las cuatro leían el stock, lo
// calculaban en el navegador y lo escribían sin comprobar nada).
//
// Reglas:
//  · el `UPDATE` de la ficha lleva el stock y `in_use` que se LEYERON como condición
//    (compare-and-set): si otra persona los cambió en el medio, no se pisa — falla;
//  · todo `UPDATE` pide `.select()` y se verifica que tocó una fila: la RLS que deja 0 filas no
//    lanza error y antes se daba por hecho;
//  · si algo falla a mitad de camino se DESHACE lo ya aplicado (ficha, desglose y kardex),
//    en vez de dejar medio retiro descontado.
// Sigue sin ser una transacción de base de datos (eso es la Fase 2: funciones atómicas); esto
// cierra los casos que se vieron, no la carrera entre dos máquinas en el mismo milisegundo.
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

/** El `UPDATE` sólo vale si la ficha sigue como se la leyó. */
function sameAsRead(q: any, mat: any) {
  const withStock = q.eq('stock', mat.stock);
  return mat.in_use == null ? withStock.is('in_use', null) : withStock.eq('in_use', mat.in_use);
}

async function casUpdateMaterial(tenantId: string, mat: any, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await sameAsRead(
    supabase.from('materials').update(patch).eq('id', mat.id).eq('tenant_id', tenantId),
    mat,
  ).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error(`El stock de ${mat.name} cambió mientras se procesaba. Vuelve a intentar.`);
}

interface DeductPlan { item: Item; mat: any; newStock: number; newInUse: number; newStatus: string }

/** Lee, valida y calcula; no escribe nada. `precheck` deja a quien llama sumar sus reglas (p. ej. la clase). */
async function planDeduction(items: Item[], tenantId: string, precheck?: (mat: any) => void): Promise<DeductPlan[]> {
  const mats = await loadMaterials(tenantId, items.map(i => i.materialId));
  return items.map((item) => {
    const mat = mats.get(item.materialId);
    if (!mat) throw new Error(`Material ${item.materialId} no existe.`);
    if (Number(mat.stock) < item.quantity) throw new Error(`Stock insuficiente para ${mat.name}.`);
    precheck?.(mat);
    const newStock = (mat.stock || 0) - item.quantity;
    const newInUse = (mat.in_use || 0) + (isAssetRow(mat) ? item.quantity : 0);
    let newStatus = mat.status;
    if (isAssetRow(mat)) {
      if (newInUse > 0) newStatus = 'En Uso';
      else if (newStock > 0) newStatus = 'Disponible';
    }
    return { item, mat, newStock, newInUse, newStatus };
  });
}

interface Applied { mat: any; sources: ConsumeSource[] | null; kardexId: string | null }

async function rollbackDeduction(applied: Applied[], tenantId: string, warehouseId: string | null) {
  for (const a of [...applied].reverse()) {
    try {
      await supabase.from('materials')
        .update({ stock: a.mat.stock, in_use: a.mat.in_use, status: a.mat.status })
        .eq('id', a.mat.id).eq('tenant_id', tenantId);
      // El desglose se repone en el contrato de donde salió; el pañol exacto no se registra, así
      // que vuelve al pañol que se prefirió al descontar (la suma por material queda igual).
      for (const s of a.sources || []) {
        await addToLedger({ tenantId, materialId: a.mat.id, contractId: s.contractId, warehouseId, qty: s.qty });
      }
      if (a.kardexId) await supabase.from('stock_movements').delete().eq('id', a.kardexId);
    } catch (e) {
      console.error('[retiros] no se pudo deshacer un descuento a medio camino', a.mat.id, e);
    }
  }
}

/** Aplica el plan: ficha (con compare-and-set), desglose y kardex. Si algo falla, deshace todo. */
async function applyDeduction(
  plan: DeductPlan[],
  p: {
    tenantId: string; contractId: string | null; contractName: string | null; warehouseId: string | null;
    relatedRequestId: string; justification: (fallbackNote: string | null) => string; userId: string; userName: string;
  },
): Promise<{ mat: any; sources: ConsumeSource[] }[]> {
  const applied: Applied[] = [];
  try {
    for (const u of plan) {
      await casUpdateMaterial(p.tenantId, u.mat, { stock: u.newStock, in_use: u.newInUse, status: u.newStatus });
      const a: Applied = { mat: u.mat, sources: null, kardexId: null };
      applied.push(a);
      // Descuenta del desglose del contrato (cascada a pool central si no alcanza),
      // prefiriendo las existencias del pañol que entrega.
      a.sources = await consumeFromLedger({ tenantId: p.tenantId, materialId: u.mat.id, contractId: p.contractId, warehouseId: p.warehouseId, qty: u.item.quantity });
      const fallbackNote = await describeConsumeSources(a.sources, p.contractId);
      const { data: k, error: kErr } = await supabase.from('stock_movements').insert({
        material_id: u.mat.id,
        material_name: u.mat.name,
        quantity_change: -u.item.quantity,
        new_stock: u.newStock,
        type: 'request-delivery',
        date: new Date().toISOString(),
        justification: p.justification(fallbackNote),
        user_id: p.userId,
        user_name: p.userName,
        related_request_id: p.relatedRequestId,
        contract_id: p.contractId,
        contract_name: p.contractName,
        warehouse_id: p.warehouseId,
        tenant_id: p.tenantId,
      }).select('id').single();
      if (kErr) throw kErr;
      a.kardexId = k?.id ?? null;
    }
    return applied.map(a => ({ mat: a.mat, sources: a.sources! }));
  } catch (e) {
    await rollbackDeduction(applied, p.tenantId, p.warehouseId);
    throw e;
  }
}

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
 * Devuelve existencias: suma el stock, baja `in_use`, reingresa al desglose y deja el kardex. Lo
 * usan las devoluciones y la anulación de un despacho. Con compare-and-set y deshaciendo si falla.
 * `statusFor` decide el estado del activo (una devolución con falla lo manda a mantenimiento).
 */
async function restockLines(
  lines: RestockLine[],
  p: {
    tenantId: string; contractId: string | null; contractName: string | null; warehouseId: string | null;
    relatedRequestId: string; justification: string; userId: string; userName: string;
    statusFor: (mat: any, newInUse: number, condition: RestockLine['condition']) => string;
  },
): Promise<{ mat: any; line: RestockLine }[]> {
  const mats = await loadMaterials(p.tenantId, lines.map(l => l.materialId));
  const done: { mat: any; qty: number; place: { contractId: string | null; warehouseId: string | null }; kardexId: string | null }[] = [];
  try {
    for (const line of lines) {
      const mat = mats.get(line.materialId);
      if (!mat) throw new Error('Uno de los materiales ya no existe: no se puede reingresar.');
      const newStock = (mat.stock || 0) + line.quantity;
      const newInUse = Math.max(0, (mat.in_use || 0) - line.quantity);
      const newStatus = isAssetRow(mat) ? p.statusFor(mat, newInUse, line.condition) : mat.status;
      await casUpdateMaterial(p.tenantId, mat, { stock: newStock, in_use: newInUse, status: newStatus });

      // Un consumible vuelve donde se recibió y al contrato indicado; un activo, al pool central y a
      // la oficina central (ver returnPlace.ts).
      const asset = isRastreable(mat.usage_type);
      const place = placeForReturn({
        isAsset: asset,
        centralWarehouseId: asset ? await findCentralWarehouseId(p.tenantId) : null,
        contractId: p.contractId,
        warehouseId: p.warehouseId,
      });
      const entry = { mat, qty: line.quantity, place, kardexId: null as string | null };
      done.push(entry);
      await addToLedger({ tenantId: p.tenantId, materialId: mat.id, contractId: place.contractId, warehouseId: place.warehouseId, qty: line.quantity });
      const { data: k, error: kErr } = await supabase.from('stock_movements').insert({
        material_id: mat.id,
        material_name: mat.name,
        quantity_change: line.quantity,
        new_stock: newStock,
        type: 'return-reentry',
        date: new Date().toISOString(),
        justification: p.justification,
        user_id: p.userId,
        user_name: p.userName,
        related_request_id: p.relatedRequestId,
        contract_id: p.contractId,
        contract_name: p.contractName,
        warehouse_id: place.warehouseId,
        tenant_id: p.tenantId,
      }).select('id').single();
      if (kErr) throw kErr;
      entry.kardexId = k?.id ?? null;
    }
    return lines.map(line => ({ mat: mats.get(line.materialId)!, line }));
  } catch (e) {
    for (const d of [...done].reverse()) {
      try {
        await supabase.from('materials').update({ stock: d.mat.stock, in_use: d.mat.in_use, status: d.mat.status }).eq('id', d.mat.id).eq('tenant_id', p.tenantId);
        await consumeFromLedger({ tenantId: p.tenantId, materialId: d.mat.id, contractId: d.place.contractId, warehouseId: d.place.warehouseId, qty: d.qty });
        if (d.kardexId) await supabase.from('stock_movements').delete().eq('id', d.kardexId);
      } catch (re) {
        console.error('[retiros] no se pudo deshacer un reingreso a medio camino', d.mat.id, re);
      }
    }
    throw e;
  }
}

/** Estado de un activo al volver: con falla va a mantenimiento; si no, en uso mientras quede alguna unidad afuera. */
const statusAfterReturn = (_mat: any, newInUse: number, condition: RestockLine['condition']) =>
  condition !== 'OK' ? 'En Mantenimiento' : newInUse > 0 ? 'En Uso' : 'Disponible';

/** Estado de un activo cuando se ANULA un despacho: nunca fue a terreno, así que no hay «falla» posible. */
const statusAfterCancel = (mat: any, newInUse: number) =>
  newInUse > 0 ? 'En Uso' : mat.status === 'En Uso' ? 'Disponible' : mat.status;

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

// ── Funciones atómicas de la base (migración 20261030000000) ─────────────────
// Aprobar, anular, devolver y entregar en ventanilla corren como UNA transacción en la base, con las filas
// bloqueadas: o queda todo o no queda nada, y dos personas a la vez no se pisan. Mientras esa migración no
// esté aplicada (`PGRST202`: la función no existe), la aplicación sigue con el camino de la Fase 1 de más
// abajo —descontar con compare-and-set y deshacer a mano—, que es seguro pero no atómico. Cuando la
// migración esté aplicada en todas las bases, ese respaldo se puede retirar.

interface RpcItem { material_id: string; name: string; usage_type: string | null; unit_cost: number | null; class: string; qty: number; sources: { contract_id: string | null; qty: number }[] }

const isMissingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|no function matches/i.test(e.message || ''));

/** Llama a una función de la base. null = no existe aún (migración sin aplicar): usar el respaldo. */
async function viaRpc<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isMissingFunction(error)) return null;
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
  const classOrder = { A: 3, B: 2, C: 1 };

  const items = mergeItems(requestData.items);
  if (!items.length) throw new Error('Debes indicar al menos un material.');
  const requestId = requestData.internalCode || await nextInternalCode(tenantId, 'TX');

  // Camino atómico: el retiro entregado, el descuento, el desglose y el kardex en UNA transacción (la clase y el
  // stock se validan adentro: o se entrega todo o no queda nada).
  const rpcDelivered = await viaRpc<{ items: RpcItem[] }>('deliver_directly', {
    p_code: requestId, p_items: items, p_area: requestData.area, p_contract_id: requestData.contractId ?? null,
    p_contract_name: requestData.contractName || null, p_supervisor: requestData.supervisorId, p_warehouse: requestData.warehouseId ?? null,
    p_contract_url: requestData.contractUrl || null, p_requires_review: !!requestData.requiresReview, p_max_class: maxDirectClass,
  });
  if (rpcDelivered) {
    await emitConsumption(toApplied(rpcDelivered.items),
      { contractId: requestData.contractId ?? null, contractName: requestData.contractName || null, requestCode: requestId }, context);
    return;
  }

  // Respaldo (migración sin aplicar). 1. Leer, validar y calcular (no escribe nada).
  const plan = await planDeduction(items, tenantId, (mat) => {
    // La columna es `criticality` (el mapper la expone como `class`). Antes se
    // leía `mat.class` de la fila cruda —siempre undefined— y toda entrega
    // directa quedaba registrada como clase C.
    const itemClass = asClass(mat.criticality);
    if (classOrder[itemClass] > classOrder[maxDirectClass]) {
      throw new Error(`${mat.name} es clase ${itemClass}: requiere aprobación antes de entregarse.`);
    }
  });
  const highestClass = highestClassOf(plan.map(u => u.mat.criticality));

  // 2. Nombres
  const { data: s } = await supabase.from('profiles').select('name').eq('id', requestData.supervisorId).maybeSingle();
  const supervisorName = s?.name || 'Usuario';
  const now = new Date().toISOString();

  // Con revisión posterior, el supervisor responsable del trabajador queda COPIADO
  // en el retiro: si después cambia de supervisor, este retiro sigue con quien
  // le correspondía. Sin responsable asignado rige el respaldo por contrato.
  let reviewerSupervisorId: string | null = null;
  if (requestData.requiresReview) {
    const { data: resp } = await supabase
      .from('profiles').select('responsible_supervisor_id').eq('id', requestData.supervisorId).maybeSingle();
    reviewerSupervisorId = resp?.responsible_supervisor_id ?? null;
  }

  // 3. El retiro entra como entregado y se descuenta; si el descuento falla, el retiro se retira
  //    también (antes quedaba «entregado» con el stock intacto).
  const { data: inserted, error: reqErr } = await supabase.from('material_requests').insert({
    internal_code: requestId,
    items,
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
    // Sólo se envía cuando aplica: así una empresa en modo 'prior' sigue
    // funcionando aunque la migración 20261007000000 aún no esté aplicada.
    ...(requestData.requiresReview ? { requires_review: true } : {}),
    ...(reviewerSupervisorId ? { reviewer_supervisor_id: reviewerSupervisorId } : {}),
    created_at: now
  }).select('id').single();
  if (reqErr) throw reqErr;

  const contractId = requestData.contractId ?? null;
  const warehouseId = requestData.warehouseId ?? null;
  let applied: { mat: any; sources: ConsumeSource[] }[];
  try {
    applied = await applyDeduction(plan, {
      tenantId, contractId, contractName: requestData.contractName || null, warehouseId,
      relatedRequestId: requestId,
      justification: (note) => `Entrega inmediata en Pañol${requestData.requiresReview ? ' con revisión posterior' : ''} (TX: ${requestId})${note ? ` — ${note}` : ''}`,
      userId: requestData.supervisorId, userName: supervisorName,
    });
  } catch (e) {
    if (inserted?.id) await supabase.from('material_requests').delete().eq('id', inserted.id).eq('tenant_id', tenantId);
    throw e;
  }
  await emitConsumption(applied, { contractId, contractName: requestData.contractName || null, requestCode: requestId }, context);
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

    // Camino atómico: el retiro, la ficha, el desglose y el kardex quedan en UNA transacción.
    const rpcApproved = await viaRpc<{ code: string | null; contract_id: string | null; contract_name: string | null; items: RpcItem[] }>(
      'approve_material_request', { p_request: requestId });
    if (rpcApproved) {
      notifyWithdrawal('approved', requestId);
      await emitConsumption(toApplied(rpcApproved.items),
        { contractId: rpcApproved.contract_id, contractName: rpcApproved.contract_name, requestCode: rpcApproved.code || request.internal_code || requestId }, context);
      return;
    }

    // Respaldo (migración sin aplicar). 1. Leer, validar y calcular (no escribe nada).
    const plan = await planDeduction(items, tenantId);

    // 2. Reservar el retiro: sólo UNA persona puede pasarlo de pendiente a aprobado.
    const { data: claimed, error: claimErr } = await supabase.from('material_requests').update({
      status: 'approved',
      approval_date: now,
      approver_id: user.id,
      approver_name: user.name,
      highest_class: realClass,
    }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'pending').select('id');
    if (claimErr) throw claimErr;
    if (!claimed?.length) throw new Error('Esta solicitud ya fue procesada por otra persona.');

    // 3. Descontar. Si falla, el retiro vuelve a pendiente y lo descontado se deshace.
    const contractId = request.contract_id ?? null;
    let applied: { mat: any; sources: ConsumeSource[] }[];
    try {
      applied = await applyDeduction(plan, {
        tenantId, contractId, contractName: request.contract_name || null, warehouseId: null,
        relatedRequestId: requestId,
        justification: (note) => `Entrega para solicitud ${request.internal_code}${note ? ` — ${note}` : ''}`,
        userId: request.supervisor_id, userName: request.supervisor_name,
      });
    } catch (e) {
      await supabase.from('material_requests').update({
        status: 'pending', approval_date: null, approver_id: null, approver_name: null,
      }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'approved');
      throw e;
    }

    // El solicitante ya puede ir a retirarlo.
    notifyWithdrawal('approved', requestId);
    await emitConsumption(applied, { contractId, contractName: request.contract_name || null, requestCode: request.internal_code || requestId }, context);
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

  // Camino atómico: la devolución del stock y el retorno del retiro a «por aprobar», en UNA transacción.
  const rpcCancelled = await viaRpc<{ code: string | null }>('cancel_approved_material_request', { p_request: requestId, p_reason: why });
  if (rpcCancelled) {
    const code = rpcCancelled.code || request.internal_code || requestId;
    notifyWithdrawal('cancelled', requestId);
    try {
      await reverseEntriesForSource('material_request', code, `Anulación de despacho: ${why}`, context);
    } catch (e: any) {
      console.error('[retiros] no se pudo reversar el costo de un despacho anulado', code, e);
      throw new Error(`El despacho se anuló y el stock volvió, pero no se pudo reversar su costo en finanzas (${e?.message || 'error'}). Avisa a soporte.`);
    }
    return;
  }

  // Respaldo (migración sin aplicar). Reservar la anulación: sólo UNA persona la hace, y sólo mientras siga sin entregarse.
  const before = {
    status: request.status, approval_date: request.approval_date, approver_id: request.approver_id, approver_name: request.approver_name,
  };
  const { data: claimed, error: claimErr } = await supabase.from('material_requests').update({
    status: 'pending', approval_date: null, approver_id: null, approver_name: null,
  }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'approved').is('delivery_date', null).select('id');
  if (claimErr) throw claimErr;
  if (!claimed?.length) throw new Error('Este despacho ya fue anulado o entregado por otra persona.');

  const code = request.internal_code || requestId;
  try {
    await restockLines(items, {
      tenantId, contractId: request.contract_id ?? null, contractName: request.contract_name || null, warehouseId: null,
      relatedRequestId: requestId,
      justification: `Anulación de despacho aprobado (${code}): ${why}`,
      userId: user.id, userName: user.name,
      statusFor: statusAfterCancel,
    });
  } catch (e) {
    await supabase.from('material_requests').update(before).eq('id', requestId).eq('tenant_id', tenantId);
    throw e;
  }

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
  verification: { mode: 'biometric' | 'exception' | 'rut'; exceptionGroupId?: string | null } | null,
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

  const now = new Date().toISOString();

  for (const item of data.items) {
    const requestId = await nextInternalCode(tenantId, 'RET');

    // Camino atómico: la devolución y el reingreso en UNA transacción (antes, si el reingreso fallaba, había que
    // borrar a mano la devolución ya «completada»).
    const rpcDirect = await viaRpc<{ restocked: { material_id: string; name: string; usage_type: string | null } }>('return_directly', {
      p_code: requestId, p_material: item.materialId, p_quantity: item.quantity, p_material_name: item.materialName, p_unit: item.unit,
      p_condition: item.condition, p_notes: item.notes || data.notes || '', p_evidence: item.evidenceUrl || data.evidenceUrl || null,
      p_worker: data.workerId, p_worker_name: data.workerName, p_contract_id: data.contractId ?? null, p_contract_name: data.contractName || null,
      p_warehouse: data.warehouseId ?? null,
    });
    if (rpcDirect) {
      const r = rpcDirect.restocked;
      await openOrdersForFailedReturns(
        [{ mat: { id: r.material_id, name: r.name, usage_type: r.usage_type }, line: { materialId: item.materialId, quantity: item.quantity, condition: item.condition } }],
        { tenantId, code: requestId, notes: item.notes || data.notes, reportedBy: handler.name });
      continue;
    }

    // Respaldo (migración sin aplicar).
    const { data: inserted, error: insertError } = await supabase.from('return_requests').insert({
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
    }).select('id').single();

    if (insertError) throw new Error(`Error al registrar devolución: ${insertError.message}`);

    let restocked: { mat: any; line: RestockLine }[];
    try {
      restocked = await restockLines([{ materialId: item.materialId, quantity: item.quantity, condition: item.condition }], {
        tenantId, contractId: data.contractId ?? null, contractName: data.contractName || null, warehouseId: data.warehouseId ?? null,
        relatedRequestId: requestId,
        justification: `Devolución inmediata en Pañol (TX: ${requestId})`,
        userId: data.workerId, userName: data.workerName,
        statusFor: statusAfterReturn,
      });
    } catch (e) {
      // Sin el reingreso no hay devolución: no puede quedar «completada» una que no sumó nada.
      if (inserted?.id) await supabase.from('return_requests').delete().eq('id', inserted.id).eq('tenant_id', tenantId);
      throw e;
    }
    await openOrdersForFailedReturns(restocked, { tenantId, code: requestId, notes: item.notes || data.notes, reportedBy: handler.name });
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

  // Camino atómico: el estado de la devolución y el reingreso (ficha, desglose, kardex) en UNA transacción.
  const rpcReturn = await viaRpc<{ code: string | null; notes: string | null; restocked: { material_id: string; name: string; usage_type: string | null; condition: string | null } | null }>(
    'complete_return_request',
    { p_return: requestId, p_status: status, p_condition: additionalData?.condition ?? null, p_evidence: additionalData?.evidenceUrl ?? null });
  if (rpcReturn) {
    if (status === 'completed' && rpcReturn.restocked) {
      const r = rpcReturn.restocked;
      await openOrdersForFailedReturns(
        [{ mat: { id: r.material_id, name: r.name, usage_type: r.usage_type }, line: { materialId: r.material_id, quantity: returnReq.quantity, condition: (additionalData?.condition) as RestockLine['condition'] } }],
        { tenantId, code: rpcReturn.code || returnReq.internal_code || requestId, notes: rpcReturn.notes ?? returnReq.notes, reportedBy: user.name });
    }
    return;
  }

  // Respaldo (migración sin aplicar).
  const now = new Date().toISOString();

  // Reservar: sólo UNA persona pasa la devolución de pendiente a resuelta.
  const { data: claimed, error: claimErr } = await supabase.from('return_requests').update({
    status: status,
    completion_date: now,
    handler_id: user.id,
    handler_name: user.name,
    return_condition: additionalData?.condition,
    evidence_url: additionalData?.evidenceUrl || null
  }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'pending').select('id');
  if (claimErr) throw claimErr;
  if (!claimed?.length) throw new Error('Esta devolución ya fue procesada por otra persona.');

  if (status === 'completed') {
    let restocked: { mat: any; line: RestockLine }[];
    try {
      restocked = await restockLines([{ materialId: returnReq.material_id, quantity: returnReq.quantity, condition: additionalData?.condition }], {
        tenantId, contractId: returnReq.contract_id ?? null, contractName: returnReq.contract_name || null, warehouseId: null,
        relatedRequestId: requestId,
        justification: `Devolución de solicitud ${returnReq.internal_code}`,
        userId: returnReq.supervisor_id, userName: returnReq.supervisor_name,
        statusFor: statusAfterReturn,
      });
    } catch (e) {
      // El reingreso no se hizo: la devolución vuelve a pendiente para que se pueda reintentar.
      await supabase.from('return_requests').update({
        status: 'pending', completion_date: null, handler_id: null, handler_name: null, return_condition: null, evidence_url: null,
      }).eq('id', requestId).eq('tenant_id', tenantId).eq('status', 'completed');
      throw e;
    }
    await openOrdersForFailedReturns(restocked, { tenantId, code: returnReq.internal_code || requestId, notes: returnReq.notes, reportedBy: user.name });
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
