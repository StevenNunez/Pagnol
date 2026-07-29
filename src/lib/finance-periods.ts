import type { SupabaseClient } from '@supabase/supabase-js';

// Cierre de período, lado servidor (F4.1 — RFC-002-F4-Plan).
//
// El soft-lock real lo aplica el trigger `finance_entries_period_guard` en la
// base. Este helper existe para que los MATERIALIZADORES (cron de MO, devengo
// de ciclos de arriendo) puedan apartar de antemano los hechos que caerían en
// un mes cerrado: insertan en lotes, y una sola fila rechazada abortaría el
// lote completo. Apartarlas permite emitir todo lo demás y REPORTAR lo que no
// se pudo — la decisión D1: nada desaparece en silencio.

/**
 * Estado vigente por mes a partir de los eventos, **ordenados de más reciente a
 * más antiguo**. Mismo criterio que `is_period_closed()` en la base: vale el
 * ÚLTIMO evento de cada mes (cerrar → reabrir → cerrar deja los tres
 * registrados, y el mes queda cerrado). Puro: la UI y los crons comparten esta
 * regla para que no puedan discrepar del guard.
 */
export function closedMonthsFromEvents(
    eventsNewestFirst: { period_month: string; action: string }[],
): Set<string> {
    const latest = new Map<string, string>();
    for (const e of eventsNewestFirst) {
        const month = String(e.period_month).slice(0, 7);
        if (!latest.has(month)) latest.set(month, e.action);
    }
    const closed = new Set<string>();
    for (const [month, action] of latest) if (action === 'close') closed.add(month);
    return closed;
}

/** Meses cerrados del tenant como set de 'YYYY-MM'. */
export async function fetchClosedMonths(
    admin: SupabaseClient,
    tenantId: string,
): Promise<Set<string>> {
    const { data, error } = await admin
        .from('finance_period_events')
        .select('period_month, action, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return closedMonthsFromEvents(data || []);
}

/** Aparta las filas cuya fecha contable cae en un mes cerrado. */
export function splitByClosedPeriod<T extends { entry_date: string }>(
    rows: T[],
    closedMonths: Set<string>,
): { insertable: T[]; blocked: T[]; blockedMonths: string[] } {
    const insertable: T[] = [];
    const blocked: T[] = [];
    const months = new Set<string>();
    for (const r of rows) {
        const month = String(r.entry_date).slice(0, 7);
        if (closedMonths.has(month)) { blocked.push(r); months.add(month); }
        else insertable.push(r);
    }
    return { insertable, blocked, blockedMonths: [...months].sort() };
}
