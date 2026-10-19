import { supabase } from '@/modules/core/lib/supabase';

/**
 * Dónde reingresa al desglose lo que se devuelve.
 *
 * Un activo (cada unidad con QR) sólo pertenece a un contrato mientras una
 * solicitud lo tiene entregado; al devolverse vuelve al stock de la empresa
 * (pool central, sin contrato) y a la oficina central, que es el centro de los
 * activos. Un consumible vuelve donde se recibió y al contrato indicado.
 */
export function placeForReturn(opts: {
    isAsset: boolean;
    centralWarehouseId: string | null;
    contractId: string | null;
    warehouseId: string | null;
}): { contractId: string | null; warehouseId: string | null } {
    if (!opts.isAsset) return { contractId: opts.contractId, warehouseId: opts.warehouseId };
    // Sin pañol central definido, el activo queda donde se recibió.
    return { contractId: null, warehouseId: opts.centralWarehouseId ?? opts.warehouseId };
}

/**
 * El pañol central activo de la empresa, o null si no hay (o si la columna aún
 * no existe porque falta aplicar la migración 20261020000000: la devolución no
 * debe fallar por eso).
 */
export async function findCentralWarehouseId(tenantId: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('warehouses')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_central', true)
        .eq('status', 'active')
        .maybeSingle();
    if (error) return null;
    return data?.id ?? null;
}
