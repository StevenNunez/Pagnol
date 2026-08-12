/**
 * Lógica pura del dominio biométrico — sin Supabase, para poder probarla.
 * Mismo criterio que `financeMath.ts` frente a `financeLedger.ts`.
 */

export interface HechoExcepcion {
    outcome: string;
    createdAt: Date;
}

/**
 * Estado de una excepción, DERIVADO de sus hechos (no existe campo de estado).
 * Gana la resolución más reciente; si no hay ninguna, sigue pendiente.
 *
 * El caso vacío devuelve 'pendiente' a propósito: ante la duda el activo NO
 * sale. Cualquier otro default convertiría un error de datos en una entrega sin
 * autorizar.
 */
export function exceptionStatus(
    hechos: HechoExcepcion[],
): 'pendiente' | 'aprobada' | 'rechazada' {
    const resoluciones = hechos
        .filter(h => h.outcome === 'exception_granted' || h.outcome === 'exception_denied')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (!resoluciones.length) return 'pendiente';
    return resoluciones[0].outcome === 'exception_granted' ? 'aprobada' : 'rechazada';
}
