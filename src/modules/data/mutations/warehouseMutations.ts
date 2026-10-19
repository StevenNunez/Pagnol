import { supabase } from '@/modules/core/lib/supabase';
import type { Warehouse } from '@/modules/core/lib/data';
import { mappers } from '../mappers';
import { transferInLedger } from './stockLedger';
import { isRastreable } from '@/lib/api/mappers';
import { emitFinanceEntries } from './financeLedger';
import { consumptionTransfers } from './financeMath';

import type { MutationContext as Context } from './context';

// ── Pañoles ───────────────────────────────────────────────────────────────────

export async function addWarehouse(
    data: {
        name: string;
        location?: string | null;
        managerId?: string | null;
        managerName?: string | null;
        notes?: string | null;
        contractIds?: string[];
        /** Sólo se envía al marcarlo: así crear pañoles sigue funcionando antes de aplicar la migración 20261020000000. */
        isCentral?: boolean;
    },
    { user, tenantId, can }: Context,
): Promise<Warehouse> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('warehouses:manage')) throw new Error('No tienes permiso para gestionar pañoles.');

    if (data.isCentral) await clearCentralWarehouse(tenantId);

    const { data: inserted, error } = await supabase
        .from('warehouses')
        .insert({
            tenant_id: tenantId,
            name: data.name.trim(),
            location: data.location || null,
            manager_id: data.managerId || null,
            manager_name: data.managerName || null,
            notes: data.notes || null,
            status: 'active',
            created_by: user.id,
            ...(data.isCentral ? { is_central: true } : {}),
        })
        .select()
        .single();
    if (error) throw error;

    await syncWarehouseContracts(inserted.id, data.contractIds || [], tenantId);
    return mappers.warehouses(inserted);
}

export async function updateWarehouse(
    id: string,
    data: Partial<Warehouse> & { contractIds?: string[] },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('warehouses:manage')) throw new Error('No tienes permiso para gestionar pañoles.');

    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.location !== undefined) payload.location = data.location;
    if (data.managerId !== undefined) payload.manager_id = data.managerId;
    if (data.managerName !== undefined) payload.manager_name = data.managerName;
    if (data.status !== undefined) payload.status = data.status;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.isCentral !== undefined) {
        if (data.isCentral) await clearCentralWarehouse(tenantId, id);
        payload.is_central = data.isCentral;
    }

    if (Object.keys(payload).length) {
        const { data: rows, error } = await supabase
            .from('warehouses')
            .update(payload)
            .eq('id', id)
            .eq('tenant_id', tenantId)
            .select('id');
        if (error) throw error;
        if (!rows?.length) throw new Error('No se pudo actualizar el pañol (RLS o no existe).');
    }

    if (data.contractIds) await syncWarehouseContracts(id, data.contractIds, tenantId);
}

/** Sólo un pañol central por empresa: al marcar uno, se desmarca el anterior. */
async function clearCentralWarehouse(tenantId: string, exceptId?: string) {
    let q = supabase.from('warehouses').update({ is_central: false }).eq('tenant_id', tenantId).eq('is_central', true);
    if (exceptId) q = q.neq('id', exceptId);
    const { error } = await q;
    if (error) throw new Error(`No se pudo definir el pañol central (¿falta aplicar la migración 20261020000000?): ${error.message}`);
}

export async function deleteWarehouse(id: string, { user, tenantId, can }: Context): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('warehouses:manage')) throw new Error('No tienes permiso para gestionar pañoles.');

    const { error } = await supabase.from('warehouses').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) {
        // FK RESTRICT desde material_stocks: hay existencias asignadas a este pañol.
        if ((error as any).code === '23503') {
            throw new Error('El pañol tiene existencias asignadas. Transfiérelas antes de eliminarlo.');
        }
        throw error;
    }
}

/** Reemplaza el set de contratos que atiende un pañol (N:M). */
async function syncWarehouseContracts(warehouseId: string, contractIds: string[], tenantId: string) {
    const { data: current, error } = await supabase
        .from('warehouse_contracts')
        .select('id, contract_id')
        .eq('warehouse_id', warehouseId)
        .eq('tenant_id', tenantId);
    if (error) throw error;

    const wanted = new Set(contractIds);
    const existing = new Set((current || []).map((r) => r.contract_id));

    const toDelete = (current || []).filter((r) => !wanted.has(r.contract_id)).map((r) => r.id);
    const toInsert = contractIds
        .filter((cid) => !existing.has(cid))
        .map((cid) => ({ tenant_id: tenantId, warehouse_id: warehouseId, contract_id: cid }));

    if (toDelete.length) {
        const { error: delErr } = await supabase.from('warehouse_contracts').delete().in('id', toDelete);
        if (delErr) throw delErr;
    }
    if (toInsert.length) {
        const { error: insErr } = await supabase.from('warehouse_contracts').insert(toInsert);
        if (insErr) throw insErr;
    }
}

// ── Transferencia de existencias entre contratos ─────────────────────────────

/**
 * Mueve stock de un material entre contratos (o desde/hacia el pool central).
 * No cambia `materials.stock` (el total del tenant no varía); solo reasigna el
 * desglose y deja doble registro en el kardex (salida origen / entrada destino).
 */
export async function transferMaterialStock(
    params: {
        materialId: string;
        qty: number;
        fromContractId: string | null;
        toContractId: string | null;
        /** Pañol de origen (undefined = de cualquiera, null = sin pañol). */
        fromWarehouseId?: string | null;
        /** Pañol de destino (null = sin pañol). */
        warehouseId?: string | null;
        justification?: string;
    },
    { user, tenantId, can }: Context,
): Promise<void> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('stock:transfer')) throw new Error('No tienes permiso para transferir stock entre contratos.');

    const { data: mat, error: matErr } = await supabase
        .from('materials')
        .select('id, name, stock, usage_type, unit_cost')
        .eq('id', params.materialId)
        .eq('tenant_id', tenantId)
        .single();
    if (matErr || !mat) throw new Error('Material no encontrado.');
    if (isRastreable(mat.usage_type) && params.toContractId !== null) {
        throw new Error('Un activo se entrega a un contrato con una solicitud de material, no con una transferencia. Aquí sólo puedes cambiarlo de pañol o devolverlo al pool central.');
    }

    // Nombres de contrato para el kardex (null = pool central).
    const ids = [params.fromContractId, params.toContractId].filter(Boolean) as string[];
    const names = new Map<string, string>();
    if (ids.length) {
        const { data: contracts } = await supabase.from('contracts').select('id, name').in('id', ids);
        for (const c of contracts || []) names.set(c.id, c.name);
    }
    const labelOf = (cid: string | null) => (cid === null ? 'Pool central' : names.get(cid) || 'Contrato');

    // Nombres de pañol para el kardex.
    const whIds = [params.fromWarehouseId, params.warehouseId].filter(Boolean) as string[];
    const whNames = new Map<string, string>();
    if (whIds.length) {
        const { data: whs } = await supabase.from('warehouses').select('id, name').eq('tenant_id', tenantId).in('id', whIds);
        for (const w of whs || []) whNames.set(w.id, w.name);
    }
    const whLabel = (wid: string | null | undefined) => (wid ? whNames.get(wid) || 'Pañol' : 'sin pañol');
    const place = (cid: string | null, wid: string | null | undefined) => `${labelOf(cid)} · ${whLabel(wid)}`;
    const fromPlace = place(params.fromContractId, params.fromWarehouseId);
    const toPlace = place(params.toContractId, params.warehouseId);

    await transferInLedger({
        tenantId,
        materialId: params.materialId,
        qty: params.qty,
        fromContractId: params.fromContractId,
        toContractId: params.toContractId,
        fromWarehouseId: params.fromWarehouseId,
        warehouseId: params.warehouseId ?? null,
    });

    const now = new Date().toISOString();
    const base = {
        material_id: mat.id,
        material_name: mat.name,
        new_stock: mat.stock, // el total no cambia en una transferencia
        type: 'contract-transfer',
        date: now,
        user_id: user.id,
        user_name: user.name,
        tenant_id: tenantId,
    };
    const reason = params.justification ? ` — ${params.justification}` : '';

    const { error: movErr } = await supabase.from('stock_movements').insert([
        {
            ...base,
            quantity_change: -params.qty,
            justification: `Transferencia a ${toPlace}${reason}`,
            contract_id: params.fromContractId,
            contract_name: params.fromContractId ? labelOf(params.fromContractId) : null,
            // Sin pañol de origen elegido, puede venir de varios (cascada): no se atribuye a uno solo.
            warehouse_id: params.fromWarehouseId ?? null,
        },
        {
            ...base,
            quantity_change: params.qty,
            justification: `Transferencia desde ${fromPlace}${reason}`,
            contract_id: params.toContractId,
            contract_name: params.toContractId ? labelOf(params.toContractId) : null,
            warehouse_id: params.warehouseId ?? null,
        },
    ]);
    if (movErr) throw movErr;

    // Emisor F2 (ADR-004 §8): una transferencia de CONSUMIBLES mueve el costo
    // devengado entre dimensiones (negativo origen / positivo destino).
    // Herramientas/activos solo cambian de ubicación: no emiten.
    // Un traslado entre pañoles del mismo contrato no mueve costo.
    if (mat.usage_type === 'Consumible' && params.fromContractId !== params.toContractId) {
        const moves = consumptionTransfers(
            [{ contractId: params.fromContractId, qty: params.qty }],
            params.toContractId,
            Number(mat.unit_cost) || 0,
        );
        if (moves.length) {
            await emitFinanceEntries(moves.map((m) => ({
                nature: 'cost' as const,
                stage: 'accrued' as const,
                category: 'materials' as const,
                amountNet: m.amountNet,
                contractId: m.contractId,
                contractName: m.contractId ? labelOf(m.contractId) : null,
                sourceType: 'stock_transfer',
                sourceId: `${mat.id}:${now}`,
                counterpartyType: 'material',
                counterpartyId: mat.id,
                counterpartyName: mat.name,
                notes: `Transferencia de stock ${labelOf(params.fromContractId)} → ${labelOf(params.toContractId)} (${params.qty} u.)${reason}`,
            })), { user, tenantId } as Context);
        }
    }
}
