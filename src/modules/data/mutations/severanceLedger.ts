import { supabase } from '@/modules/core/lib/supabase';
import type { MutationContext as Context } from './context';
import type { Severance } from '@/modules/core/lib/data';
import { emitFinanceEntries, reverseEntriesForSource } from './financeLedger';
import { splitCostByContract, type LaborDayFact } from './payrollLedgerMath';

// Remuneraciones F5 — emisores del finiquito al ledger (ADR-012).
//
// A diferencia de la planilla (ADR-010), el finiquito NO reemplaza ninguna
// estimación: las indemnizaciones y el feriado proporcional son costo nuevo que
// nunca se devengó día a día. Por eso acá no hay reverso previo — solo emisión.
//
// 🔴 LA TRAMPA DE ESTA FASE: el finiquito INCLUYE el líquido de la liquidación
// del último mes (decisión de Steven), pero ese monto YA lo emitió la planilla
// que lo calculó — con su propio costo y su propio payable. Emitirlo de nuevo
// acá duplicaría el costo de personal del mes y dejaría el margen mintiendo.
// Por eso al ledger va solo `ledgerAmount()`: los conceptos PROPIOS del
// finiquito. Es el mismo patrón que obligó a apartar los meses liquidados del
// cron de MO en F4.

export const SEVERANCE_LEDGER_AUTHOR = 'Sistema (finiquitos)';

/** `severance` como fuente. Un finiquito es de un solo trabajador. */
export function severanceSourceId(severanceId: string): string {
    return severanceId;
}

/**
 * Lo que el finiquito aporta al ledger: sus conceptos propios, sin el líquido del
 * último mes (que pertenece a la planilla) y ya neto de descuentos.
 */
export function ledgerAmount(s: Severance): number {
    const propios = (Number(s.indemnityYears) || 0)
        + (Number(s.indemnityNotice) || 0)
        + (Number(s.vacationPay) || 0)
        - (Number(s.totalDeductions) || 0);
    return Math.round(Math.max(0, propios));
}

export interface SeveranceLedgerResult {
    emittedCosts: number;
    totalCost: number;
    /** true si el costo fue al pool por no encontrar días imputados a obra. */
    withoutContract: boolean;
}

/**
 * Emite el costo del finiquito y la obligación de pagarlo.
 *
 * Se imputa a las obras donde el trabajador estuvo en su ÚLTIMO MES trabajado:
 * es la mejor proporción disponible —una indemnización no tiene "días"— y deja
 * el costo donde estuvo la persona, que es lo que el margen por contrato quiere
 * mostrar. Si no hay días, va al pool en vez de repartirse: esconderlo haría
 * invisible un problema de datos.
 *
 * Los hechos se fechan en la FECHA DE TÉRMINO, no hoy: es cuando el hecho
 * económico existe. Consecuencia buscada: ese mes no puede estar contablemente
 * cerrado, igual que en la planilla.
 */
export async function emitSeveranceCost(
    severance: Severance,
    { user, tenantId }: Context,
): Promise<SeveranceLedgerResult> {
    if (!tenantId) throw new Error('Sin inquilino para emitir el finiquito.');
    const amount = ledgerAmount(severance);
    if (!amount) return { emittedCosts: 0, totalCost: 0, withoutContract: false };

    const entryDate = severance.endDate.slice(0, 10);
    const month = `${entryDate.slice(0, 7)}-01`;

    // Proporción de obras del último mes trabajado.
    const { data: dias, error: dErr } = await supabase.rpc('labor_days_by_contract', {
        p_month: month,
        p_user_ids: [severance.userId],
        p_tenant: tenantId,
    });
    if (dErr) throw dErr;

    const facts: LaborDayFact[] = [];
    for (const row of (dias || []) as any[]) {
        for (let i = 0; i < Number(row.days); i++) {
            facts.push({
                sourceId: `${severance.userId}:${month}`,
                contractId: row.contract_id ?? null,
                contractName: row.contract_name ?? null,
                amountNet: 0,
            });
        }
    }

    const shares = splitCostByContract(amount, facts);
    const withoutContract = shares.length === 1 && shares[0].contractId === null && shares[0].days === 0;

    const sourceId = severanceSourceId(severance.id);
    const code = `FINIQUITO-${entryDate}`;
    const entries = shares.map((s) => ({
        entryDate,
        nature: 'cost' as const,
        stage: 'accrued' as const,
        category: 'labor' as const,
        amountNet: s.amount,
        contractId: s.contractId,
        contractName: s.contractName,
        sourceType: 'severance',
        sourceId,
        sourceCode: code,
        counterpartyType: 'worker',
        counterpartyId: severance.userId,
        counterpartyName: severance.userName,
        notes: s.days
            ? `Finiquito · ${s.days} día(s) en la obra en su último mes`
            : 'Finiquito · sin días imputados a obra',
    }));

    // Obligación de caja por los conceptos propios del finiquito. El líquido del
    // último mes ya tiene su propio payable en la planilla.
    entries.push({
        entryDate,
        nature: 'payable' as any,
        stage: 'committed' as any,
        category: 'labor' as const,
        amountNet: amount,
        dueDate: null,
        sourceType: 'severance_payable',
        sourceId,
        sourceCode: code,
        counterpartyType: 'worker',
        counterpartyId: severance.userId,
        counterpartyName: severance.userName,
        notes: 'Por pagar · finiquito',
    } as any);

    await emitFinanceEntries(entries as any, { user, tenantId } as Context);

    return {
        emittedCosts: shares.length,
        totalCost: amount,
        withoutContract,
    };
}

/**
 * Registra el pago: apaga la obligación por reverso (nunca UPDATE) y emite el
 * hecho `paid`, fechado el día que salió la plata.
 */
export async function emitSeverancePayment(
    severance: Severance,
    { user, tenantId }: Context,
): Promise<{ reversedPayables: number; total: number }> {
    if (!tenantId) throw new Error('Sin inquilino para registrar el pago del finiquito.');
    if (!severance.paymentDate) throw new Error('El finiquito no tiene fecha de pago.');

    const amount = ledgerAmount(severance);
    if (!amount) return { reversedPayables: 0, total: 0 };

    const sourceId = severanceSourceId(severance.id);
    const reversed = await reverseEntriesForSource(
        'severance_payable', sourceId,
        `Finiquito pagado el ${severance.paymentDate}`,
        { user, tenantId } as Context,
    );

    await emitFinanceEntries([{
        entryDate: severance.paymentDate,
        nature: 'cost' as const,
        stage: 'paid' as const,
        category: 'labor' as const,
        amountNet: amount,
        sourceType: 'severance_payment',
        sourceId,
        sourceCode: `FINIQUITO-${severance.endDate.slice(0, 10)}`,
        counterpartyType: 'worker',
        counterpartyId: severance.userId,
        counterpartyName: severance.userName,
        notes: 'Pagado · finiquito',
    }] as any, { user, tenantId } as Context);

    return { reversedPayables: reversed, total: amount };
}

/**
 * Deshace lo emitido. No se usa hoy (un finiquito cerrado es inmutable) pero
 * existe por la misma razón que su equivalente en la planilla: el día que haya
 * "anular finiquito", sin esto el costo quedaría huérfano en el ledger.
 */
export async function reverseSeveranceCost(
    severance: Severance,
    reason: string,
    ctx: Context,
): Promise<number> {
    const sourceId = severanceSourceId(severance.id);
    let n = 0;
    n += await reverseEntriesForSource('severance', sourceId, reason, ctx);
    n += await reverseEntriesForSource('severance_payable', sourceId, reason, ctx);
    return n;
}
