import type { SupabaseClient } from '@supabase/supabase-js';
import {
    buildEntryRow,
    reconcileLaborDay,
    rentalNetToClp,
    type LaborLiveEntry,
} from '@/modules/data/mutations/financeMath';
import { LABOR_WINDOW_DAYS, todaySantiago } from '@/lib/labor-cost';
import { fetchClosedMonths, splitByClosedPeriod } from '@/lib/finance-periods';

// Devengo diario de ciclos de arriendo (F2 — ADR-004 §5): una cuota cuyo
// vencimiento ya pasó es costo devengado del período, se haya pagado o no.
// Igual que el costo de MO (ADR-003), es una DERIVACIÓN del paso del tiempo:
// materializador con ventana móvil, idempotente, INSERT-only.
//
// Solo reconcilia la etapa DEVENGADO: el comprometido lo emite confirmRentalOc
// y el pagado lo emite markRentalPaymentPaid (con sus reversos en las
// mutaciones). Cuotas eliminadas también se reversan en la mutación — aquí solo
// se procesan cuotas EXISTENTES con vencimiento dentro de la ventana.

const RENTAL_SYSTEM_AUTHOR = 'Sistema (devengo arriendo)';

export interface RentalAccrualStats {
    tenantId: string;
    window: { from: string; to: string };
    cycles: number;        // cuotas vencidas evaluadas
    emitted: number;
    mirrors: number;
    ratesMissing: number;  // cuotas UF sin tasa disponible (no se tocan)
    /** Devengos no emitidos por caer en un mes cerrado (F4.1): se reportan, no
     *  se pierden — el cron reintenta en cada corrida. */
    blocked: number;
    blockedMonths: string[];
}

function addDaysIso(iso: string, days: number): string {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export async function materializeRentalAccrualsForTenant(
    admin: SupabaseClient,
    tenantId: string,
    opts?: { windowDays?: number },
): Promise<RentalAccrualStats> {
    const today = todaySantiago();
    const from = addDaysIso(today, -(opts?.windowDays ?? LABOR_WINDOW_DAYS));
    const to = addDaysIso(today, -1); // el día abierto no devenga

    // Cuotas vencidas en ventana, con su contrato de arriendo embebido.
    const { data: payments, error: pErr } = await admin
        .from('rental_payments')
        .select('id, amount, due_date, contract_id, rental_contracts(currency, client_contract_id, oc_number, code, title, party_id)')
        .eq('tenant_id', tenantId)
        .gte('due_date', from)
        .lte('due_date', to);
    if (pErr) throw pErr;
    if (!payments?.length) {
        return { tenantId, window: { from, to }, cycles: 0, emitted: 0, mirrors: 0, ratesMissing: 0, blocked: 0, blockedMonths: [] };
    }

    // Hechos vivos de esas fuentes (solo etapa devengado). Todo hecho de una
    // cuota en ventana tiene entry_date >= from (original = vencimiento;
    // espejos = día de emisión, posterior).
    const paymentIds = new Set(payments.map((p) => p.id));
    const { data: entries, error: eErr } = await admin
        .from('finance_entries')
        .select('id, source_id, amount_net, contract_id, contract_name, created_at')
        .eq('tenant_id', tenantId)
        .eq('source_type', 'rental_payment')
        .eq('stage', 'accrued')
        .gte('entry_date', from)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    if (eErr) throw eErr;

    const liveBySource = new Map<string, LaborLiveEntry[]>();
    for (const e of entries || []) {
        if (!paymentIds.has(e.source_id)) continue;
        const arr = liveBySource.get(e.source_id) || [];
        arr.push({ id: e.id, amountNet: Number(e.amount_net) || 0, contractId: e.contract_id ?? null, contractName: e.contract_name ?? null });
        liveBySource.set(e.source_id, arr);
    }

    // Tasas UF de la ventana (+ margen) para congelar cada ciclo con la tasa de
    // su vencimiento (o la última disponible antes de él).
    const { data: rates } = await admin
        .from('uf_rates')
        .select('rate_date, value')
        .gte('rate_date', addDaysIso(from, -40))
        .order('rate_date', { ascending: false });
    const rateFor = (date: string): number | null => {
        for (const r of rates || []) if (r.rate_date <= date) return Number(r.value);
        return null;
    };

    // Nombres de contratos cliente para el snapshot.
    const { data: contracts } = await admin.from('contracts').select('id, name').eq('tenant_id', tenantId);
    const contractNameById = new Map<string, string>((contracts || []).map((c) => [c.id, c.name]));

    const rows: any[] = [];
    let emitted = 0, mirrors = 0, ratesMissing = 0;

    for (const p of payments) {
        const rc: any = Array.isArray(p.rental_contracts) ? p.rental_contracts[0] : p.rental_contracts;
        if (!rc) continue;
        const currency = rc.currency || 'CLP';
        const ufRate = currency === 'UF' ? rateFor(p.due_date) : null;
        if (currency === 'UF' && !ufRate) { ratesMissing++; continue; } // sin tasa no se toca

        const amountOriginal = Number(p.amount) || 0;
        const amountNet = rentalNetToClp(amountOriginal, currency, ufRate);
        const expected = amountNet > 0
            ? { amountNet, contractId: (rc.client_contract_id as string | null) ?? null }
            : null;

        // Misma decisión pura que MO: vivo == esperado ⇒ no-op; si no, espejos + re-emisión.
        const { mirrors: srcMirrors, emit } = reconcileLaborDay(expected, liveBySource.get(p.id) || []);
        if (!srcMirrors.length && !emit) continue;

        const common = {
            nature: 'cost' as const,
            stage: 'accrued' as const,
            category: 'rental' as const,
            currency,
            sourceType: 'rental_payment',
            sourceId: p.id,
            sourceCode: rc.oc_number || rc.code || null,
            counterpartyType: 'supplier',
            counterpartyId: rc.party_id ?? null,
        };

        for (const m of srcMirrors) {
            rows.push({
                ...buildEntryRow({
                    ...common,
                    currency: 'CLP',
                    entryDate: today,
                    amountNet: m.amountNet,
                    contractId: m.contractId,
                    contractName: m.contractName,
                    notes: 'Reconciliación de ciclo de arriendo (monto/imputación cambió).',
                }, tenantId, null),
                reversal_of: m.reversalOf,
                created_by_name: RENTAL_SYSTEM_AUTHOR,
            });
            mirrors++;
        }
        if (emit) {
            rows.push({
                ...buildEntryRow({
                    ...common,
                    entryDate: p.due_date, // fecha contable = vencimiento del ciclo
                    amountNet: emit.amountNet,
                    amountOriginal,
                    fxRate: currency === 'UF' ? ufRate ?? 1 : 1,
                    contractId: emit.contractId,
                    contractName: emit.contractId ? contractNameById.get(emit.contractId) ?? null : null,
                    notes: `Ciclo de arriendo vencido — ${rc.title || ''}`.trim(),
                }, tenantId, null),
                created_by_name: RENTAL_SYSTEM_AUTHOR,
            });
            emitted++;
        }
    }

    // Los devengos de ciclo se fechan en el VENCIMIENTO de la cuota, así que un
    // mes cerrado los rechaza. Se apartan antes del lote (ver finance-periods).
    const closedMonths = await fetchClosedMonths(admin, tenantId);
    const { insertable, blocked, blockedMonths } = splitByClosedPeriod(rows, closedMonths);

    const BATCH = 500;
    for (let i = 0; i < insertable.length; i += BATCH) {
        const { error } = await admin.from('finance_entries').insert(insertable.slice(i, i + BATCH));
        if (error) throw error;
    }

    return {
        tenantId, window: { from, to }, cycles: payments.length, emitted, mirrors, ratesMissing,
        blocked: blocked.length, blockedMonths,
    };
}
