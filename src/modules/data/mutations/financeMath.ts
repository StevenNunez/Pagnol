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
    /** Neto en CLP para cost/income; BRUTO para payable/receivable (miden caja,
     *  no resultado). Los reversos los emite el servidor: no pases negativos. */
    amountNet: number;
    /** Vencimiento (YYYY-MM-DD). Solo lo llenan los emisores que lo conocen al
     *  emitir —factura, cuota de arriendo—; alimenta el flujo de caja (F4.2). */
    dueDate?: string | null;
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

// ─── F2: ingresos EP, arriendos y consumo de pañol (ADR-004) ─────────────────

/**
 * Delta del período de un Estado de Pago (ADR-004 §2): lo ÚNICO que se devenga.
 * `previous` = acumulado del último EP vivo del contrato. Devuelve el delta
 * redondeado; ≤ 0 significa "no hay avance nuevo que cobrar" (el llamador bloquea).
 */
export function epPeriodEarned(currentEarned: number, previousEarned: number): number {
    if (!Number.isFinite(currentEarned) || !Number.isFinite(previousEarned)) return 0;
    return Math.round(currentEarned) - Math.round(previousEarned);
}

/**
 * Neto CLP de un monto de arriendo según su moneda (congelado al emitir).
 * UF exige tasa del día; USD/otras quedan 1:1 documentado (igual que F0)
 * hasta que exista fuente de tasa.
 */
export function rentalNetToClp(amount: number, currency: string, ufRate?: number | null): number {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (currency === 'UF') {
        if (!ufRate || !Number.isFinite(ufRate) || ufRate <= 0) return 0; // sin tasa no se inventa
        return toClp(amount, ufRate);
    }
    return Math.round(amount);
}

export interface ConsumeSourceLike {
    contractId: string | null;
    qty: number;
}

/**
 * Transferencia de costo de un consumo de pañol (ADR-004 §7-8): la recepción ya
 * devengó cada unidad en la dimensión donde cayó (contrato o pool="Sin contrato").
 * Al entregar a `toContractId`, toda unidad que venga de OTRA dimensión mueve su
 * costo: hecho negativo en el origen + positivo en el destino. Lo que ya estaba
 * en el contrato destino no emite nada (una unidad nunca costea dos veces).
 */
export function consumptionTransfers(
    sources: ConsumeSourceLike[],
    toContractId: string | null,
    unitCost: number,
): { contractId: string | null; amountNet: number }[] {
    if (!Number.isFinite(unitCost) || unitCost <= 0) return [];
    const out: { contractId: string | null; amountNet: number }[] = [];
    let moved = 0;
    for (const s of sources) {
        if (s.contractId === toContractId || s.qty <= 0) continue;
        const amount = Math.round(s.qty * unitCost);
        if (amount === 0) continue;
        out.push({ contractId: s.contractId, amountNet: -amount });
        moved += amount;
    }
    if (moved > 0) out.push({ contractId: toContractId, amountNet: moved });
    return out;
}

// ─── F3: presupuesto de costo (ADR-005) ──────────────────────────────────────

/**
 * Rollup de líneas de presupuesto: vigente por clave (contrato o
 * contrato|categoría). Las líneas negativas (rebajas) restan; el vigente puede
 * quedar en 0 pero se reporta igual (un presupuesto rebajado a 0 es información).
 */
export function budgetRollup<T extends { contractId: string; category: string; amountNet: number }>(
    lines: T[],
): Map<string, number> {
    const out = new Map<string, number>();
    for (const l of lines) {
        const amount = Math.round(Number(l.amountNet) || 0);
        out.set(l.contractId, (out.get(l.contractId) || 0) + amount);
        const key = `${l.contractId}|${l.category}`;
        out.set(key, (out.get(key) || 0) + amount);
    }
    return out;
}

/** % de ejecución presupuestaria: devengado / vigente (null sin presupuesto). */
export function budgetExecutionPct(accrued: number, budget: number): number | null {
    if (!Number.isFinite(budget) || budget <= 0) return null;
    return Math.round((accrued / budget) * 100);
}

/**
 * Fuentes cuyos hechos NACEN devengados: no existe un compromiso previo que
 * registrar, así que su devengado JAMÁS fue contado como comprometido.
 *
 * Las demás cadenas sí se comprometen primero (purchase_order → goods_receipt,
 * rental_contract → rental_payment): ahí el devengado ya está representado en
 * el comprometido y sumarlo lo contaría dos veces.
 *
 * Si se agrega un emisor nuevo, esta lista decide si su costo consume
 * presupuesto — revísala al escribir el emisor (addendum a ADR-005).
 */
// `payroll_run` se suma en F4 de remuneraciones (ADR-010): el costo real de la
// planilla nace DEVENGADO, sin compromiso previo, igual que labor_day. Sin esto el
// presupuesto volvería a mostrar "ejecutado" junto a "100% disponible" para el
// mayor costo de una faena — el bug que destapó el E2E de F3.
export const UNCOMMITTED_SOURCES = ['labor_day', 'material_request', 'stock_transfer', 'payroll_run'] as const;

/**
 * Cuánto presupuesto consume realmente la ejecución de un contrato/categoría.
 *
 *     consumido = comprometido + devengado de las fuentes sin compromiso previo
 *
 * Nace del E2E de F3: `presupuesto − comprometido` dejaba fuera el costo de mano
 * de obra (el mayor de una faena), y la fila mostraba "49% ejecutado" junto a
 * "100% disponible". Trabaja sobre las filas del RPC `finance_contract_summary`,
 * que desde la migración 20260724000000 desglosa por `source_type`.
 */
export function budgetConsumption<
    T extends { stage: string; source_type?: string | null; total_net: number | string },
>(rows: T[]): number {
    const uncommitted = new Set<string>(UNCOMMITTED_SOURCES);
    let total = 0;
    for (const r of rows) {
        const amount = Number(r.total_net) || 0;
        if (r.stage === 'committed') total += amount;
        else if (r.stage === 'accrued' && uncommitted.has(r.source_type || '')) total += amount;
    }
    return Math.round(total);
}

/**
 * Normaliza un input a la fila snake_case que espera `finance_entries`.
 */
export function buildEntryRow(input: FinanceEntryInput, tenantId: string, user: { id: string; name: string } | null) {
    const amountNet = Math.round(input.amountNet);
    return {
        tenant_id: tenantId,
        entry_date: input.entryDate ?? new Date().toISOString().slice(0, 10),
        due_date: input.dueDate ?? null,
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
