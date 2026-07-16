import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';
import { buildEntryRow, type FinanceEntryInput } from './financeMath';

export { DEFAULT_TAX_RATE, netFromGross, toClp, buildEntryRow } from './financeMath';
export type { FinanceEntryInput } from './financeMath';

/**
 * Ledger financiero (tabla `finance_entries`) — RFC-002, F0.
 *
 * Espejo del patrón stockLedger elevado a dinero: los módulos operativos emiten
 * hechos económicos inmutables en transiciones de estado bien definidas
 * (OC emitida → comprometido; recepción → devengado; factura pagada → pagado).
 *
 * Constitución (ARCHITECTURAL_MANIFESTO v2.0):
 *  - Art. 2: los hechos NO se editan ni borran (el esquema no lo permite).
 *    Corregir = emitir reversos vía `reverseEntriesForSource`.
 *  - Art. 5: todo hecho lleva autor (lo inyecta el Context de la mutación).
 *
 * La matemática pura (neto/bruto, UF→CLP, armado de filas) vive en
 * financeMath.ts para poder testearse sin Supabase.
 */

/**
 * Emite un lote de hechos. Ignora montos 0 (una línea sin valor no es un hecho).
 * Falla en voz alta: un emisor que no puede registrar el hecho debe abortar la
 * operación que lo origina (el hecho ES parte de la operación, no un log).
 */
export async function emitFinanceEntries(
    entries: FinanceEntryInput[],
    { user, tenantId }: Context,
): Promise<void> {
    if (!tenantId) throw new Error('Inquilino no válido para emitir hechos financieros.');
    const rows = entries
        .filter((e) => Math.round(e.amountNet) !== 0)
        .map((e) => buildEntryRow(e, tenantId, user ? { id: user.id, name: user.name } : null));
    if (!rows.length) return;
    const { error } = await supabase.from('finance_entries').insert(rows);
    if (error) throw error;
}

/**
 * Reversa todos los hechos vivos de un documento origen (RPC SECURITY DEFINER:
 * el usuario operativo puede reversar sin poder LEER el ledger). Idempotente —
 * un documento ya neteado en 0 no emite nada. Devuelve cuántos reversos emitió.
 */
export async function reverseEntriesForSource(
    sourceType: string,
    sourceId: string,
    reason: string,
    { tenantId }: Context,
): Promise<number> {
    if (!tenantId) throw new Error('Inquilino no válido para reversar hechos financieros.');
    const { data, error } = await supabase.rpc('finance_reverse_source', {
        p_source_type: sourceType,
        p_source_id: sourceId,
        p_reason: reason,
        // Solo tiene efecto para super-admin con tenant conmutado; el resto de
        // usuarios queda clavado a su tenant en el servidor.
        p_tenant: tenantId,
    });
    if (error) throw error;
    return Number(data) || 0;
}
