// Los encargados de un pañol. Un pañol trabaja por turnos: atienden dos o tres pañoleros a la vez, así que el
// encargado ya no es una persona sino una lista (`warehouses.manager_ids`, migración 20261031000000). Puro: lo
// comparten el mapeo de la fila, la pantalla de pañoles, el cierre de transacciones y la desvinculación.

export interface RowWithManagers { manager_ids?: unknown }

/**
 * La lista de encargados de una fila de `warehouses`, sin repetidos ni vacíos y en orden (el primero es el
 * principal). Una fila sin la columna (o con algo que no es una lista) no tiene encargados.
 */
export function managerIdsFromRow(row: RowWithManagers): string[] {
    const list = Array.isArray(row.manager_ids) ? row.manager_ids : [];
    return [...new Set(list.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

/** ¿Esta persona es encargada de este pañol? */
export const isWarehouseManager = (w: { managerIds?: readonly string[] | null }, userId: string | null | undefined): boolean =>
    !!userId && !!w.managerIds?.includes(userId);

/** Los nombres de los encargados, en orden; un id sin ficha (persona dada de baja) se omite. */
export function managerNames(w: { managerIds?: readonly string[] | null }, nameOf: (id: string) => string | undefined): string[] {
    return (w.managerIds ?? []).map(nameOf).filter((n): n is string => !!n);
}
