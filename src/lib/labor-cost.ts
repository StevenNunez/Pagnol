import type { SupabaseClient } from '@supabase/supabase-js';
import {
    LABOR_SYSTEM_AUTHOR,
    buildEntryRow,
    laborDayExpected,
    laborDayPresence,
    laborDaySourceId,
    parseLaborSourceId,
    reconcileLaborDay,
    type LaborDayLog,
    type LaborLiveEntry,
} from '@/modules/data/mutations/financeMath';
import { fetchClosedMonths, splitByClosedPeriod } from './finance-periods';

// Materializador del costo de mano de obra (Dominio Financiero F1 — ADR-003).
//
// Primer emisor del ledger que NO vive en una mutación: el "día trabajado" es
// una derivación de marcas in/out que se editan retroactivamente, así que un
// cron diario materializa los días CERRADOS y re-verifica una ventana móvil.
// Si las marcas, el sueldo o el factor cambiaron, emite espejo negativo + hecho
// corregido (misma semántica que finance_reverse_source, insertado directo con
// service role porque el cron no tiene auth.uid()). El esquema sigue sin
// permitir UPDATE/DELETE a nadie (Art. 2): esto solo INSERTa.
//
// La decisión pura (presencia, costo, reconciliación) vive en financeMath.ts
// con tests; aquí solo se consulta, se decide por (trabajador, día) y se
// inserta en lotes.

export const LABOR_WINDOW_DAYS = 35;

export interface LaborMaterializeStats {
    tenantId: string;
    window: { from: string; to: string };
    scannedDays: number;   // pares (trabajador, día) evaluados
    emitted: number;       // hechos nuevos
    mirrors: number;       // espejos de reverso
    noSalaryWorkers: number; // trabajadores con presencia y sin sueldo base (alerta)
    noContractDays: number;  // días devengados sin contrato (alerta)
    /** Hechos que NO se emitieron porque su fecha contable cae en un mes cerrado
     *  (F4.1). Se reportan en vez de perderse: el cron reintenta cada día y el
     *  panel los muestra hasta que alguien reabra el período o los asuma. */
    blocked: number;
    blockedMonths: string[]; // 'YYYY-MM' afectados, para el mensaje de la UI
}

/** Hoy en America/Santiago (nunca se materializa un día aún abierto). */
export function todaySantiago(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function addDaysIso(iso: string, days: number): string {
    const d = new Date(`${iso}T12:00:00Z`); // mediodía UTC: inmune a DST
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Pagina de a 1000 (límite PostgREST) hasta agotar el query. */
async function fetchAll<T>(makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
    const all: T[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await makeQuery(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data || [];
        all.push(...batch);
        if (batch.length < PAGE) return all;
    }
}

/**
 * Reconcilia la ventana [hoy−N, ayer] de un tenant: unión de días con marcas y
 * días con hechos vivos. Idempotente — una segunda corrida sin cambios no
 * inserta nada.
 */
export async function materializeLaborForTenant(
    admin: SupabaseClient,
    tenant: { id: string; laborCostFactor: number },
    opts?: { windowDays?: number },
): Promise<LaborMaterializeStats> {
    const today = todaySantiago();
    const windowDays = opts?.windowDays ?? LABOR_WINDOW_DAYS;
    const from = addDaysIso(today, -windowDays);
    const to = addDaysIso(today, -1); // ayer: el día abierto no se toca
    const factor = Number(tenant.laborCostFactor) > 0 ? Number(tenant.laborCostFactor) : 1.35;

    const [logs, entries, profiles, contracts] = await Promise.all([
        fetchAll<any>((a, b) => admin
            .from('attendance_logs')
            .select('user_id, user_name, date, type, mark_type, contract_id, timestamp')
            .eq('tenant_id', tenant.id)
            .gte('date', from).lte('date', to)
            .order('id', { ascending: true })
            .range(a, b)),
        // Todo hecho de una fuente en ventana tiene entry_date >= from (los
        // originales llevan el día trabajado; los espejos, su día de emisión,
        // siempre posterior). El filtro fino por día de la fuente va abajo.
        fetchAll<any>((a, b) => admin
            .from('finance_entries')
            .select('id, source_id, amount_net, contract_id, contract_name, created_at')
            .eq('tenant_id', tenant.id)
            .eq('source_type', 'labor_day')
            .gte('entry_date', from)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(a, b)),
        fetchAll<any>((a, b) => admin
            .from('profiles')
            .select('id, name, base_salary')
            .eq('tenant_id', tenant.id)
            .range(a, b)),
        fetchAll<any>((a, b) => admin
            .from('contracts')
            .select('id, name')
            .eq('tenant_id', tenant.id)
            .range(a, b)),
    ]);

    const profileById = new Map<string, { name: string; baseSalary: number | null }>(
        profiles.map((p) => [p.id, { name: p.name, baseSalary: p.base_salary != null ? Number(p.base_salary) : null }]),
    );
    const contractNameById = new Map<string, string>(contracts.map((c) => [c.id, c.name]));

    const logsByKey = new Map<string, LaborDayLog[]>();
    const nameFromLogs = new Map<string, string>();
    for (const l of logs) {
        if (!l.user_id || !l.date) continue;
        const key = `${l.user_id}|${l.date}`;
        const arr = logsByKey.get(key) || [];
        arr.push({ type: l.type, markType: l.mark_type ?? null, contractId: l.contract_id ?? null, timestamp: l.timestamp || '' });
        logsByKey.set(key, arr);
        if (l.user_name && !nameFromLogs.has(l.user_id)) nameFromLogs.set(l.user_id, l.user_name);
    }

    const liveByKey = new Map<string, LaborLiveEntry[]>();
    for (const e of entries) {
        const { userId, date } = parseLaborSourceId(e.source_id || ':');
        if (!userId || date < from || date > to) continue; // fuente fuera de ventana: congelada
        const key = `${userId}|${date}`;
        const arr = liveByKey.get(key) || [];
        arr.push({ id: e.id, amountNet: Number(e.amount_net) || 0, contractId: e.contract_id ?? null, contractName: e.contract_name ?? null });
        liveByKey.set(key, arr);
    }

    const keys = new Set<string>([...logsByKey.keys(), ...liveByKey.keys()]);
    const rows: any[] = [];
    const noSalary = new Set<string>();
    let emitted = 0, mirrors = 0, noContractDays = 0;

    for (const key of keys) {
        const [userId, date] = key.split('|');
        const dayLogs = logsByKey.get(key) || [];
        const profile = profileById.get(userId);
        const expected = laborDayExpected(dayLogs, profile?.baseSalary, factor);
        if (!expected && profile && (profile.baseSalary ?? 0) <= 0 && laborDayPresence(dayLogs)) {
            noSalary.add(userId); // presencia sin sueldo: alerta, no hecho $0 (ADR-003 §4)
        }

        const { mirrors: dayMirrors, emit } = reconcileLaborDay(expected, liveByKey.get(key) || []);
        if (!dayMirrors.length && !emit) continue;

        const sourceId = laborDaySourceId(userId, date);
        const counterpartyName = profile?.name || nameFromLogs.get(userId) || 'Trabajador';
        const common = {
            nature: 'cost' as const,
            stage: 'accrued' as const,
            category: 'labor' as const,
            sourceType: 'labor_day',
            sourceId,
            counterpartyType: 'worker',
            counterpartyId: userId,
            counterpartyName,
        };

        for (const m of dayMirrors) {
            rows.push({
                ...buildEntryRow({
                    ...common,
                    entryDate: today, // el espejo se fecha el día que se detecta (patrón finance_reverse_source)
                    amountNet: m.amountNet,
                    contractId: m.contractId,
                    contractName: m.contractName,
                    notes: 'Reconciliación MO: la asistencia, el sueldo o el factor cambiaron.',
                }, tenant.id, null),
                reversal_of: m.reversalOf,
                created_by_name: LABOR_SYSTEM_AUTHOR,
            });
            mirrors++;
        }
        if (emit) {
            rows.push({
                ...buildEntryRow({
                    ...common,
                    entryDate: date, // fecha contable = el día trabajado, aunque se materialice después
                    amountNet: emit.amountNet,
                    contractId: emit.contractId,
                    contractName: emit.contractId ? contractNameById.get(emit.contractId) ?? null : null,
                }, tenant.id, null),
                created_by_name: LABOR_SYSTEM_AUTHOR,
            });
            emitted++;
            if (!emit.contractId) noContractDays++;
        }
    }

    // Cierre de período (F4.1): un hecho fechado en un mes cerrado sería
    // rechazado por el trigger y, como el INSERT va en lotes, tumbaría el lote
    // entero. Se apartan ANTES y se reportan — no se pierden en silencio ni
    // bloquean al resto (decisión D1 del RFC-002-F4-Plan).
    const closedMonths = await fetchClosedMonths(admin, tenant.id);
    const { insertable, blocked, blockedMonths } = splitByClosedPeriod(rows, closedMonths);

    const BATCH = 500;
    for (let i = 0; i < insertable.length; i += BATCH) {
        const { error } = await admin.from('finance_entries').insert(insertable.slice(i, i + BATCH));
        if (error) throw error;
    }

    return {
        tenantId: tenant.id,
        window: { from, to },
        scannedDays: keys.size,
        emitted,
        mirrors,
        noSalaryWorkers: noSalary.size,
        noContractDays,
        blocked: blocked.length,
        blockedMonths,
    };
}
