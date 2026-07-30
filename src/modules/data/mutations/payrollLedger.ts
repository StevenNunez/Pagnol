import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';
import type { PayrollRun, PayrollLine } from '@/modules/core/lib/data';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { splitCostByContract, type LaborDayFact } from './payrollLedgerMath';

// Remuneraciones F4 — emisores del costo REAL de personal (ADR-010).
//
// Al cerrar la planilla, la estimación del ledger (`labor_day` = sueldo/30 × 1,35)
// se apaga y la reemplaza el costo empresa real, imputado a las obras en la misma
// proporción de días que tenía la estimación. Al pagar, la obligación se apaga y
// nace el hecho `paid`.
//
// Por qué los hechos se fechan en el ÚLTIMO DÍA DEL MES LIQUIDADO y no hoy: el
// margen y el reporte del período tienen que cuadrar. La consecuencia es que ese
// mes no puede estar contablemente cerrado — de ahí el guard.

/** Autor de sistema de los hechos de remuneración (Art. 5). */
export const PAYROLL_LEDGER_AUTHOR = 'Sistema (remuneraciones)';

/** Último día del mes de la planilla: fecha contable de todos sus hechos. */
export function payrollEntryDate(periodMonth: string): string {
    const start = new Date(`${periodMonth.slice(0, 7)}-01T00:00:00`);
    start.setMonth(start.getMonth() + 1);
    start.setDate(0);
    const y = start.getFullYear();
    const m = String(start.getMonth() + 1).padStart(2, '0');
    const d = String(start.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** `payroll_run` como fuente: un hecho por trabajador dentro de la planilla. */
export function payrollSourceId(runId: string, userId: string): string {
    return `${runId}:${userId}`;
}

export interface PayrollLedgerResult {
    /** Hechos de estimación que se apagaron. */
    reversedEstimates: number;
    /** Hechos de costo real emitidos (uno por trabajador × obra). */
    emittedCosts: number;
    /** Total del costo empresa que entró al ledger. */
    totalCost: number;
    /** Trabajadores cuyo costo fue al pool por no tener días imputados a obra. */
    withoutContract: string[];
}

/**
 * Reemplaza la estimación del mes por el costo real de la planilla.
 *
 * Orden importante: primero se leen los días por obra (para saber la proporción),
 * DESPUÉS se reversa y al final se emite. Leer después de reversar daría cero días
 * y todo el costo caería al pool.
 */
export async function emitPayrollCost(
    run: PayrollRun,
    lines: PayrollLine[],
    { user, tenantId }: Context,
): Promise<PayrollLedgerResult> {
    if (!tenantId) throw new Error('Sin inquilino para emitir el costo de personal.');
    const entryDate = payrollEntryDate(run.periodMonth);
    const userIds = lines.map((l) => l.userId);
    if (!userIds.length) return { reversedEstimates: 0, emittedCosts: 0, totalCost: 0, withoutContract: [] };

    // ── 1. La proporción de días por obra, ANTES de reversar
    const { data: dias, error: dErr } = await supabase.rpc('labor_days_by_contract', {
        p_month: `${run.periodMonth.slice(0, 7)}-01`,
        p_user_ids: userIds,
        p_tenant: tenantId,
    });
    if (dErr) throw dErr;

    const factsByUser = new Map<string, LaborDayFact[]>();
    for (const row of (dias || []) as any[]) {
        const arr = factsByUser.get(row.user_id) || [];
        // La RPC ya viene agregada por obra: se expande a un "hecho" por día para
        // que splitCostByContract cuente igual que con los hechos crudos.
        for (let i = 0; i < Number(row.days); i++) {
            arr.push({
                sourceId: `${row.user_id}:${run.periodMonth.slice(0, 7)}-01`,
                contractId: row.contract_id ?? null,
                contractName: row.contract_name ?? null,
                amountNet: Number(row.estimated_net) || 0,
            });
        }
        factsByUser.set(row.user_id, arr);
    }

    // ── 2. Apagar la estimación del mes (falla en voz alta si el período cerró)
    const { data: reversed, error: rErr } = await supabase.rpc('finance_reverse_labor_month', {
        p_month: `${run.periodMonth.slice(0, 7)}-01`,
        p_reason: `Reemplazo por planilla real ${run.periodMonth.slice(0, 7)}`,
        p_user_ids: userIds,
        p_tenant: tenantId,
    });
    if (rErr) throw rErr;

    // ── 3. Emitir el costo real por trabajador × obra
    const entries = [];
    const withoutContract: string[] = [];
    let totalCost = 0;

    for (const line of lines) {
        const cost = Math.round(Number(line.employerCost) || 0);
        if (!cost) continue;
        const shares = splitCostByContract(cost, factsByUser.get(line.userId) || []);
        if (shares.length === 1 && shares[0].contractId === null && shares[0].days === 0) {
            withoutContract.push(line.userName);
        }
        for (const s of shares) {
            entries.push({
                entryDate,
                nature: 'cost' as const,
                stage: 'accrued' as const,
                category: 'labor' as const,
                amountNet: s.amount,
                contractId: s.contractId,
                contractName: s.contractName,
                sourceType: 'payroll_run',
                sourceId: payrollSourceId(run.id, line.userId),
                sourceCode: `PLANILLA-${run.periodMonth.slice(0, 7)}`,
                counterpartyType: 'worker',
                counterpartyId: line.userId,
                counterpartyName: line.userName,
                notes: s.days
                    ? `Costo empresa real · ${s.days} día(s) en la obra · planilla ${run.periodMonth.slice(0, 7)}`
                    : `Costo empresa real · sin días imputados a obra · planilla ${run.periodMonth.slice(0, 7)}`,
            });
            totalCost += s.amount;
        }

        // Obligación de caja: el desembolso total de la planilla (líquidos +
        // cotizaciones). SIN due_date: al cerrar no hay fecha comprometida y
        // estimarla sería inventarla (misma decisión que los EP en F4.2).
        entries.push({
            entryDate,
            nature: 'payable' as const,
            stage: 'committed' as const,
            category: 'labor' as const,
            amountNet: cost,
            dueDate: null,
            sourceType: 'payroll_run_payable',
            sourceId: payrollSourceId(run.id, line.userId),
            sourceCode: `PLANILLA-${run.periodMonth.slice(0, 7)}`,
            counterpartyType: 'worker',
            counterpartyId: line.userId,
            counterpartyName: line.userName,
            notes: `Por pagar · planilla ${run.periodMonth.slice(0, 7)}`,
        });
    }

    await emitFinanceEntries(entries, { user, tenantId } as Context);

    return {
        reversedEstimates: Number(reversed) || 0,
        emittedCosts: entries.filter((e) => e.nature === 'cost').length,
        totalCost,
        withoutContract,
    };
}

/**
 * Registra el pago: apaga la obligación por reverso (Art. 2, nunca UPDATE) y
 * emite el hecho `paid`. Es el emisor real de remuneraciones que el plan de F4 del
 * dominio financiero daba por inexistente (decisión D3 de Steven).
 *
 * El `paid` se fecha en la FECHA DE PAGO real, no en el mes liquidado: el costo
 * pertenece al mes trabajado, la caja al día que salió la plata.
 */
export async function emitPayrollPayment(
    run: PayrollRun,
    lines: PayrollLine[],
    { user, tenantId }: Context,
): Promise<{ reversedPayables: number; emittedPayments: number; total: number }> {
    if (!tenantId) throw new Error('Sin inquilino para registrar el pago de personal.');
    if (!run.paymentDate) throw new Error('La planilla no tiene fecha de pago.');

    let reversedPayables = 0;
    const entries = [];
    let total = 0;

    for (const line of lines) {
        const cost = Math.round(Number(line.employerCost) || 0);
        if (!cost) continue;
        const sourceId = payrollSourceId(run.id, line.userId);

        // Apagar la obligación
        reversedPayables += await reverseEntriesForSource(
            'payroll_run_payable', sourceId,
            `Planilla ${run.periodMonth.slice(0, 7)} pagada el ${run.paymentDate}`,
            { user, tenantId } as Context,
        );

        entries.push({
            entryDate: run.paymentDate,
            nature: 'cost' as const,
            stage: 'paid' as const,
            category: 'labor' as const,
            amountNet: cost,
            sourceType: 'payroll_run_payment',
            sourceId,
            sourceCode: `PLANILLA-${run.periodMonth.slice(0, 7)}`,
            counterpartyType: 'worker',
            counterpartyId: line.userId,
            counterpartyName: line.userName,
            notes: `Pagado · planilla ${run.periodMonth.slice(0, 7)}`,
        });
        total += cost;
    }

    await emitFinanceEntries(entries, { user, tenantId } as Context);
    return { reversedPayables, emittedPayments: entries.length, total };
}

/**
 * Deshace lo emitido por el cierre. NO se usa hoy —una planilla cerrada es
 * inmutable— pero existe para el día en que se agregue "anular planilla": sin
 * esto, anular dejaría el costo real huérfano en el ledger y el mes contaría dos
 * veces cuando se emita la planilla correctora.
 */
export async function reversePayrollCost(
    run: PayrollRun,
    lines: PayrollLine[],
    reason: string,
    ctx: Context,
): Promise<number> {
    let n = 0;
    for (const line of lines) {
        const sourceId = payrollSourceId(run.id, line.userId);
        n += await reverseEntriesForSource('payroll_run', sourceId, reason, ctx);
        n += await reverseEntriesForSource('payroll_run_payable', sourceId, reason, ctx);
        n += await reverseEntriesForSource('payroll_run_payment', sourceId, reason, ctx);
    }
    return n;
}
