import type { FinanceCategory, FinanceNature, FinanceStage } from '@/modules/core/lib/data';

/**
 * Matemática de dinero del ledger financiero (RFC-002, F0) — funciones puras,
 * sin Supabase, testeables en aislamiento (financeLedger.test.ts).
 *
 * Convención: el ledger guarda montos NETOS en CLP (enteros) congelados al
 * momento del hecho; moneda origen + tasa se preservan por columna.
 */

export interface FinanceEntryInput {
    /** Fecha contable ISO (YYYY-MM-DD). Default: hoy. */
    entryDate?: string;
    nature: FinanceNature;
    stage: FinanceStage;
    category: FinanceCategory;
    /** Neto en CLP (los reversos los emite el servidor, no pases negativos aquí). */
    amountNet: number;
    currency?: string;          // default 'CLP'
    amountOriginal?: number;    // default = amountNet
    fxRate?: number;            // default 1
    taxRate?: number | null;
    contractId?: string | null;
    contractName?: string | null;
    workItemId?: string | null;
    costCenterId?: string | null;
    sourceType: string;         // 'purchase_order' | 'goods_receipt' | 'supplier_payment' | ...
    sourceId: string;
    sourceCode?: string | null;
    counterpartyType?: string | null;
    counterpartyId?: string | null;
    counterpartyName?: string | null;
    notes?: string | null;
}

/** IVA chileno por defecto para derivar neto desde un monto bruto de factura. */
export const DEFAULT_TAX_RATE = 19;

/** Neto desde un bruto con IVA (CLP se maneja en enteros). */
export function netFromGross(gross: number, taxRate: number = DEFAULT_TAX_RATE): number {
    if (!Number.isFinite(gross) || gross === 0) return 0;
    return Math.round(gross / (1 + taxRate / 100));
}

/** Convierte un monto en moneda origen a CLP con la tasa del día (congelada en el hecho). */
export function toClp(amountOriginal: number, fxRate: number): number {
    if (!Number.isFinite(amountOriginal) || !Number.isFinite(fxRate)) return 0;
    return Math.round(amountOriginal * fxRate);
}

// ─── F1: costo de mano de obra (labor_day) ───────────────────────────────────
// Modelo "solo días asistidos" (ADR-003): presencia × sueldo/30 × factor.
// El materializador (src/lib/labor-cost.ts) consulta y escribe; aquí vive la
// decisión pura para poder testearla sin Supabase.

/** Autor de sistema de los hechos de MO (Art. 5: autoría explícita del proceso). */
export const LABOR_SYSTEM_AUTHOR = 'Sistema (costo MO)';

/**
 * Marcas importadas que SÍ son presencia (P=presente, ATR=atraso, MJ=media
 * jornada). Una marca 'in' sin mark_type es un scan normal = presencia.
 * A/D/LM/PSG/V/PP se importan igual como type='in' pero NO son días trabajados.
 */
const WORKED_MARKS = new Set(['P', 'ATR', 'MJ']);

/** Costo empresa de un día-persona: sueldo/30 × factor, redondeado a peso. */
export function laborDayCost(baseSalary: number, laborCostFactor: number): number {
    if (!Number.isFinite(baseSalary) || baseSalary <= 0) return 0;
    if (!Number.isFinite(laborCostFactor) || laborCostFactor <= 0) return 0;
    return Math.round((baseSalary / 30) * laborCostFactor);
}

/** source_id canónico del hecho día-persona: `{userId}:{yyyy-MM-dd}`. */
export function laborDaySourceId(userId: string, date: string): string {
    return `${userId}:${date}`;
}

/** Descompone un source_id `{userId}:{yyyy-MM-dd}` (el userId es uuid, sin ':'). */
export function parseLaborSourceId(sourceId: string): { userId: string; date: string } {
    const idx = sourceId.lastIndexOf(':');
    return { userId: sourceId.slice(0, idx), date: sourceId.slice(idx + 1) };
}

export interface LaborDayLog {
    type: 'in' | 'out';
    markType?: string | null;
    contractId?: string | null;
    /** ISO — solo se usa para ordenar y elegir la primera entrada del día. */
    timestamp: string;
}

/**
 * Presencia del día: ≥1 marca 'in' trabajada (scan normal o P/ATR/MJ); el pareo
 * in/out es para horas, no para presencia (ADR-003 §3). Devuelve el contrato de
 * la PRIMERA marca trabajada del día (resuelto por el scan en su momento);
 * null ⇒ "Sin contrato" (alerta, no se adivina retroactivamente).
 */
export function laborDayPresence(logs: LaborDayLog[]): { contractId: string | null } | null {
    const worked = logs
        .filter((l) => l.type === 'in' && (l.markType == null || WORKED_MARKS.has(l.markType)))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!worked.length) return null;
    return { contractId: worked[0].contractId ?? null };
}

/**
 * Qué debería existir en el ledger para un (trabajador, día):
 * presencia × sueldo/30 × factor. Sin presencia o sin sueldo ⇒ null
 * (no se inventa un costo $0 — ADR-003 §4).
 */
export function laborDayExpected(
    logs: LaborDayLog[],
    baseSalary: number | null | undefined,
    laborCostFactor: number,
): { amountNet: number; contractId: string | null } | null {
    const presence = laborDayPresence(logs);
    if (!presence) return null;
    const amountNet = laborDayCost(baseSalary ?? 0, laborCostFactor);
    if (amountNet <= 0) return null;
    return { amountNet, contractId: presence.contractId };
}

export interface LaborLiveEntry {
    id: string;
    amountNet: number;
    contractId: string | null;
    contractName: string | null;
}

export interface LaborReconcileResult {
    /** Espejos negativos a insertar (misma semántica que finance_reverse_source). */
    mirrors: { amountNet: number; contractId: string | null; contractName: string | null; reversalOf: string }[];
    /** Hecho nuevo a emitir (null si lo esperado es ∅ o lo vivo ya coincide). */
    emit: { amountNet: number; contractId: string | null } | null;
}

/**
 * Decisión pura de reconciliación de un (trabajador, día) — idempotente:
 *  vivo == esperado → no-op; si no → espejo negativo por grupo de contrato
 *  (reversal_of al primer hecho del grupo) + hecho nuevo si esperado > 0.
 * `live` debe venir en orden de creación (el primer id del grupo ancla el espejo).
 */
export function reconcileLaborDay(
    expected: { amountNet: number; contractId: string | null } | null,
    live: LaborLiveEntry[],
): LaborReconcileResult {
    const groups = new Map<string, { net: number; contractId: string | null; contractName: string | null; firstId: string }>();
    for (const e of live) {
        const key = e.contractId ?? '__none__';
        const g = groups.get(key);
        if (g) {
            g.net += e.amountNet;
            if (!g.contractName && e.contractName) g.contractName = e.contractName;
        } else {
            groups.set(key, { net: e.amountNet, contractId: e.contractId ?? null, contractName: e.contractName ?? null, firstId: e.id });
        }
    }
    const alive = Array.from(groups.values()).filter((g) => Math.round(g.net) !== 0);

    const matches =
        expected === null
            ? alive.length === 0
            : alive.length === 1 &&
              alive[0].contractId === expected.contractId &&
              Math.round(alive[0].net) === Math.round(expected.amountNet);
    if (matches) return { mirrors: [], emit: null };

    return {
        mirrors: alive.map((g) => ({
            amountNet: -g.net,
            contractId: g.contractId,
            contractName: g.contractName,
            reversalOf: g.firstId,
        })),
        emit: expected,
    };
}

/**
 * Normaliza un input a la fila snake_case que espera `finance_entries`.
 */
export function buildEntryRow(input: FinanceEntryInput, tenantId: string, user: { id: string; name: string } | null) {
    const amountNet = Math.round(input.amountNet);
    return {
        tenant_id: tenantId,
        entry_date: input.entryDate ?? new Date().toISOString().slice(0, 10),
        nature: input.nature,
        stage: input.stage,
        category: input.category,
        amount_net: amountNet,
        currency: input.currency ?? 'CLP',
        amount_original: input.amountOriginal ?? amountNet,
        fx_rate: input.fxRate ?? 1,
        tax_rate: input.taxRate ?? null,
        contract_id: input.contractId ?? null,
        contract_name: input.contractName ?? null,
        work_item_id: input.workItemId ?? null,
        cost_center_id: input.costCenterId ?? null,
        source_type: input.sourceType,
        source_id: input.sourceId,
        source_code: input.sourceCode ?? null,
        counterparty_type: input.counterpartyType ?? null,
        counterparty_id: input.counterpartyId ?? null,
        counterparty_name: input.counterpartyName ?? null,
        reversal_of: null,
        notes: input.notes ?? null,
        created_by: user?.id ?? null,
        created_by_name: user?.name ?? null,
    };
}
