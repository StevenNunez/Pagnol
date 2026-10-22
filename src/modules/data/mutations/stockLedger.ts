import { supabase } from '@/modules/core/lib/supabase';

/**
 * Ledger de existencias por contrato × pañol (tabla `material_stocks`).
 *
 * `materials.stock` sigue siendo el TOTAL del tenant; este módulo mantiene el
 * desglose que dice a qué contrato pertenecen las unidades. Toda mutación que
 * toque `materials.stock` debe llamar al helper equivalente aquí para que la
 * suma del desglose calce siempre con el total.
 *
 * contractId NULL = pool central de la empresa (sin contrato asignado).
 */

type LedgerRow = {
    id: string;
    contract_id: string | null;
    warehouse_id: string | null;
    qty: number;
};

/**
 * Pañol donde queda físicamente lo que se recibe de una compra. El contrato de la compra dice
 * de quién es el costo; el pañol dice dónde está. Si quien recibe no eligió uno, va a la oficina
 * central (`warehouses.is_central`); si la empresa no tiene una activa, queda sin pañol, como antes.
 */
export async function resolveReceivingWarehouse(
    tenantId: string,
    requested?: string | null,
): Promise<string | null> {
    // `undefined` = nadie eligió (oficina central); `null` = se eligió expresamente «sin pañol».
    if (requested === null) return null;
    if (requested) return requested;
    const { data, error } = await supabase
        .from('warehouses')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_central', true)
        .eq('status', 'active')
        .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
}

export interface ConsumeSource {
    contractId: string | null;
    qty: number;
}

/** Suma `qty` unidades al desglose del contrato/pañol indicado (upsert). */
export async function addToLedger(params: {
    tenantId: string;
    materialId: string;
    contractId?: string | null;
    warehouseId?: string | null;
    qty: number;
}): Promise<void> {
    const { tenantId, materialId, qty } = params;
    if (qty <= 0) return;
    const contractId = params.contractId ?? null;
    const warehouseId = params.warehouseId ?? null;

    let query = supabase
        .from('material_stocks')
        .select('id, qty')
        .eq('tenant_id', tenantId)
        .eq('material_id', materialId);
    query = contractId === null ? query.is('contract_id', null) : query.eq('contract_id', contractId);
    query = warehouseId === null ? query.is('warehouse_id', null) : query.eq('warehouse_id', warehouseId);
    const { data: existing, error: selErr } = await query.maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
        const { error } = await supabase
            .from('material_stocks')
            .update({ qty: Number(existing.qty) + qty })
            .eq('id', existing.id);
        if (error) throw error;
    } else {
        const { error } = await supabase.from('material_stocks').insert({
            tenant_id: tenantId,
            material_id: materialId,
            contract_id: contractId,
            warehouse_id: warehouseId,
            qty,
        });
        // Carrera contra el índice único: otro proceso creó la fila → reintenta como update.
        if (error) {
            if ((error as any).code === '23505') return addToLedger(params);
            throw error;
        }
    }
}

/**
 * Descuenta `qty` unidades del desglose, con política de cascada:
 *   1) del contrato solicitado,
 *   2) si no alcanza, del pool central (contract_id NULL),
 *   3) si aún no alcanza, de otros contratos (de mayor a menor existencia).
 * Si se indica `warehouseId` (pañol del panolero que entrega), dentro de cada
 * nivel de la cascada se consumen primero las filas de ese pañol.
 * La cascada mantiene la invariante "suma del desglose == materials.stock":
 * quien valida stock total es la mutación llamadora (contra `materials.stock`).
 *
 * Devuelve de dónde salieron las unidades para que el llamador lo registre en
 * el kardex / avise al usuario cuando hubo fallback.
 */
export async function consumeFromLedger(params: {
    tenantId: string;
    materialId: string;
    contractId?: string | null;
    warehouseId?: string | null;
    qty: number;
}): Promise<ConsumeSource[]> {
    const { tenantId, materialId, qty } = params;
    if (qty <= 0) return [];
    const contractId = params.contractId ?? null;
    const warehouseId = params.warehouseId ?? null;

    const { data, error } = await supabase
        .from('material_stocks')
        .select('id, contract_id, warehouse_id, qty')
        .eq('tenant_id', tenantId)
        .eq('material_id', materialId)
        .gt('qty', 0);
    if (error) throw error;

    const rows = (data || []) as LedgerRow[];
    // Orden de consumo: contrato pedido → pool central → resto (mayor existencia primero).
    // Dentro de cada nivel, primero las filas del pañol indicado.
    const rank = (r: LedgerRow) =>
        r.contract_id === contractId ? 0 : r.contract_id === null ? 1 : 2;
    const whRank = (r: LedgerRow) => (warehouseId !== null && r.warehouse_id === warehouseId ? 0 : 1);
    rows.sort((a, b) => rank(a) - rank(b) || whRank(a) - whRank(b) || Number(b.qty) - Number(a.qty));

    let remaining = qty;
    const sources: ConsumeSource[] = [];
    for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(row.qty), remaining);
        if (take <= 0) continue;
        const { error: updErr } = await supabase
            .from('material_stocks')
            .update({ qty: Number(row.qty) - take })
            .eq('id', row.id);
        if (updErr) throw updErr;
        remaining -= take;

        const prev = sources.find((s) => s.contractId === row.contract_id);
        if (prev) prev.qty += take;
        else sources.push({ contractId: row.contract_id, qty: take });
    }

    // Si el desglose quedó corto (drift histórico), lo descontado "extra" no
    // existe en el ledger: se registra como consumo del contrato pedido para
    // que la suma no quede por sobre el stock real.
    if (remaining > 0) {
        const prev = sources.find((s) => s.contractId === contractId);
        if (prev) prev.qty += remaining;
        else sources.push({ contractId, qty: remaining });
    }

    return sources;
}

/**
 * Mueve `qty` unidades de un contrato a otro (mismo material). A diferencia de
 * `consumeFromLedger`, NO hay cascada: el origen debe tener existencias
 * suficientes o se lanza error (una transferencia es una decisión explícita).
 */
export async function transferInLedger(params: {
    tenantId: string;
    materialId: string;
    qty: number;
    fromContractId: string | null;
    toContractId: string | null;
    /** Pañol de origen: `undefined` = de cualquiera, `null` = de lo que no tiene pañol, id = de ese pañol. */
    fromWarehouseId?: string | null;
    /** Pañol de destino (`null` = sin pañol). */
    warehouseId?: string | null;
}): Promise<void> {
    const { tenantId, materialId, qty, fromContractId, toContractId, fromWarehouseId } = params;
    if (qty <= 0) throw new Error('La cantidad a transferir debe ser mayor que 0.');
    // Mismo contrato sólo vale si cambia de pañol: es un traslado entre pañoles.
    const sameContract = fromContractId === toContractId;
    if (sameContract && (fromWarehouseId === undefined || fromWarehouseId === (params.warehouseId ?? null))) {
        throw new Error(fromWarehouseId === undefined
            ? 'El contrato de origen y destino son el mismo.'
            : 'El origen y el destino son el mismo contrato y el mismo pañol.');
    }

    let query = supabase
        .from('material_stocks')
        .select('id, contract_id, warehouse_id, qty')
        .eq('tenant_id', tenantId)
        .eq('material_id', materialId)
        .gt('qty', 0);
    query = fromContractId === null ? query.is('contract_id', null) : query.eq('contract_id', fromContractId);
    if (fromWarehouseId === null) query = query.is('warehouse_id', null);
    else if (fromWarehouseId !== undefined) query = query.eq('warehouse_id', fromWarehouseId);
    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as LedgerRow[];
    const available = rows.reduce((acc, r) => acc + Number(r.qty), 0);
    if (available < qty) {
        throw new Error(
            `Existencias insuficientes en el origen: hay ${available} y se intenta transferir ${qty}.`
        );
    }

    let remaining = qty;
    for (const row of rows) {
        if (remaining <= 0) break;
        const take = Math.min(Number(row.qty), remaining);
        const { error: updErr } = await supabase
            .from('material_stocks')
            .update({ qty: Number(row.qty) - take })
            .eq('id', row.id);
        if (updErr) throw updErr;
        remaining -= take;
    }

    await addToLedger({
        tenantId,
        materialId,
        contractId: toContractId,
        warehouseId: params.warehouseId ?? null,
        qty,
    });
}
