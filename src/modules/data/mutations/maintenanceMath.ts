// Cuándo una orden de trabajo (OT) deja a un equipo fuera de servicio, y en qué estado queda el equipo
// cuando ya no hay ninguna que lo retenga. Puro: no toca la base, así que se prueba solo.
//
// POR QUÉ EXISTE: las OT y el estado del activo eran dos mundos que no se hablaban. Crear una OT no
// cambiaba el estado del activo y cerrarla tampoco; sólo una devolución con falla lo mandaba a
// «En Mantenimiento», sin crear ninguna OT, y nada lo sacaba de ahí (VALAR-ACT-0019 llevaba así desde
// septiembre). Un activo «En Mantenimiento» sin OT no está en el pañol ni lo está arreglando nadie.

export type OrderStatus = 'OPEN' | 'IN_PROGRESS' | 'WAITING_PARTS' | 'COMPLETED' | 'CANCELLED';
export type OrderType = 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE';

export interface OrderLite { status: string; type: string }

const OPEN_STATES: string[] = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'];

/** Una OT sigue abierta mientras no esté completada ni cancelada. */
export const isOpenOrder = (o: Pick<OrderLite, 'status'>) => OPEN_STATES.includes(o.status);

/**
 * ¿Esta OT tiene al equipo fuera de servicio? Una correctiva ya abierta sí (hay una falla), y
 * cualquiera que esté en curso o esperando repuestos. Una preventiva sólo programada (`OPEN`) no: el
 * equipo sigue trabajando hasta que se la empiece.
 */
export function takesOutOfService(o: OrderLite): boolean {
    if (o.status === 'IN_PROGRESS' || o.status === 'WAITING_PARTS') return true;
    return o.status === 'OPEN' && o.type === 'CORRECTIVE';
}

export interface AssetLite { status: string | null | undefined; inUse: number; usageType?: string | null }

/**
 * El estado al que hay que pasar el activo según sus OT, o null si no hay nada que cambiar.
 *  · hay una OT que lo retiene y el equipo estaba disponible → «En Mantenimiento»;
 *  · ya no hay ninguna y estaba «En Mantenimiento» → vuelve a «En Uso» si alguien aún tiene unidades,
 *    o a «Disponible»;
 *  · un consumible no tiene estado de equipo, y uno «Para Baja» no se revive por una OT.
 * Un equipo «En Uso» (lo tiene un trabajador) no se toca al abrir la OT: sigue en terreno.
 */
export function assetStatusAfterOrders(asset: AssetLite, orders: readonly OrderLite[]): string | null {
    if (asset.usageType === 'Consumible') return null;
    if (asset.status === 'Para Baja') return null;
    const retained = orders.some(takesOutOfService);
    if (retained && asset.status === 'Disponible') return 'En Mantenimiento';
    if (!retained && asset.status === 'En Mantenimiento') return asset.inUse > 0 ? 'En Uso' : 'Disponible';
    return null;
}
