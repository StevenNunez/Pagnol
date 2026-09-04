import { supabase } from '@/modules/core/lib/supabase';
import type { FinancePeriodEvent, FinancePeriodWarning } from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import { closedMonthsFromEvents } from '@/lib/finance-periods';

// Cierre de período (F4.1 — RFC-002-F4-Plan). El soft-lock lo aplica un trigger
// en la base (`finance_entries_period_guard`), no estas funciones: hay nueve
// emisores y dos crons, y congelar el pasado no puede depender de que todos
// recuerden chequear. Acá vive solo la administración del cierre.

/** Normaliza cualquier fecha del mes al primer día ('YYYY-MM-01'). */
export function toPeriodMonth(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(`${date.slice(0, 10)}T12:00:00`) : date;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function mapEvent(item: any): FinancePeriodEvent {
    return {
        id: item.id,
        tenantId: item.tenant_id,
        periodMonth: item.period_month,
        action: item.action,
        reason: item.reason || null,
        createdBy: item.created_by || null,
        createdByName: item.created_by_name || null,
        createdAt: item.created_at,
    };
}

/** Todos los eventos del tenant, del más reciente al más antiguo. */
export async function fetchPeriodEvents(tenantId: string): Promise<FinancePeriodEvent[]> {
    const { data, error } = await supabase
        .from('finance_period_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapEvent);
}

/**
 * Meses cerrados → el evento de cierre vigente (para mostrar quién y cuándo).
 * La regla de "qué mes está cerrado" vive en `closedMonthsFromEvents` y la
 * comparten la UI, los crons y —en su versión SQL— el guard de la base.
 */
export function closedMonths(events: FinancePeriodEvent[]): Map<string, FinancePeriodEvent> {
    // fetchPeriodEvents devuelve descendente: el primero de cada mes es el vigente.
    const closedSet = closedMonthsFromEvents(
        events.map((e) => ({ period_month: e.periodMonth, action: e.action })),
    );
    const out = new Map<string, FinancePeriodEvent>();
    for (const e of events) {
        const month = e.periodMonth.slice(0, 7);
        if (closedSet.has(month) && !out.has(e.periodMonth)) out.set(e.periodMonth, e);
    }
    return out;
}

/** Advertencias antes de cerrar: costos que quedarían fuera del mes congelado. */
export async function precheckPeriod(month: string, tenantId: string): Promise<FinancePeriodWarning[]> {
    const { data, error } = await supabase.rpc('finance_period_precheck', {
        p_month: toPeriodMonth(month),
        p_tenant: tenantId,
    });
    if (error) throw error;
    return (data || []).map((r: any) => ({
        kind: r.kind,
        severity: r.severity,
        detail: r.detail,
        count: Number(r.count) || 0,
        amount: r.amount === null ? null : Number(r.amount),
    }));
}

async function emitEvent(
    month: string,
    action: 'close' | 'reopen',
    reason: string | null,
    { user, tenantId, can }: Context,
): Promise<FinancePeriodEvent> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!can('finance:manage'))
        throw new Error('No tienes permiso para administrar el cierre de períodos.');

    const { data, error } = await supabase
        .from('finance_period_events')
        .insert({
            tenant_id: tenantId,
            period_month: toPeriodMonth(month),
            action,
            reason,
            created_by: user.id,
            created_by_name: user.name,
        })
        .select()
        .single();
    if (error) throw error;
    return mapEvent(data);
}

/**
 * Cierra un mes: a partir de aquí el ledger rechaza hechos con fecha contable
 * dentro de él. No valida que el mes haya terminado — cerrar el mes en curso es
 * legítimo (y bloquea incluso los reversos, que se fechan hoy).
 */
export async function closePeriod(
    { month, reason }: { month: string; reason?: string },
    ctx: Context,
): Promise<FinancePeriodEvent> {
    return emitEvent(month, 'close', reason?.trim() || null, ctx);
}

/**
 * Reabre un mes cerrado. El motivo es obligatorio: reabrir deshace la garantía
 * de que el histórico no cambia, y esa decisión queda con nombre y razón.
 */
export async function reopenPeriod(
    { month, reason }: { month: string; reason: string },
    ctx: Context,
): Promise<FinancePeriodEvent> {
    if (!reason?.trim())
        throw new Error('Reabrir un período cerrado exige un motivo (queda en el historial).');
    return emitEvent(month, 'reopen', reason.trim(), ctx);
}
