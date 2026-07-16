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
