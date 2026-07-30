import { supabase } from '@/modules/core/lib/supabase';
import { userCan } from '@/modules/core/lib/permissions';
import type {
    Severance, PublicHoliday, EmploymentContract, SalaryAdvance,
} from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import {
    calculateSeverance, type SeveranceInput, type SeveranceResult,
    type TerminationCause,
} from './severanceMath';
import { contractAt, mapEmploymentContract } from './payrollMutations';
import { emitSeveranceCost, emitSeverancePayment } from './severanceLedger';

// Remuneraciones F5 — finiquitos persistentes (RFC-003 / ADR-012).
//
// Misma separación que la planilla:
//   proposeSeverance()      consulta y PROPONE (no escribe nada)
//   saveSeveranceDraft()    corre el motor y persiste el borrador
//   closeSeverance()        congela el documento y lo emite al ledger
//   markSeverancePaid()     registra el pago real
//
// La propuesta no escribe porque tres datos requieren criterio humano antes de
// emitir: la causal de término, si se dio el aviso de 30 días, y los días de
// feriado progresivo que el trabajador haya acreditado.

function requireHr(user: Context['user']) {
    if (!user) throw new Error('No autenticado.');
    if (!userCan(user, 'hr_employees:edit'))
        throw new Error('No tienes permiso para administrar finiquitos.');
}

const n = (v: any) => Number(v) || 0;

export function mapSeverance(r: any): Severance {
    return {
        id: r.id,
        tenantId: r.tenant_id,
        userId: r.user_id,
        userName: r.user_name,
        employmentContractId: r.employment_contract_id || null,
        status: r.status,
        startDate: r.start_date,
        endDate: r.end_date,
        cause: r.cause,
        noticeGiven: !!r.notice_given,
        lastRemuneration: n(r.last_remuneration),
        ufValue: r.uf_value === null ? null : Number(r.uf_value),
        vacationDaysTaken: n(r.vacation_days_taken),
        progressiveDays: n(r.progressive_days),
        deductions: r.deductions || [],
        lastPayrollRunId: r.last_payroll_run_id || null,
        lastPayrollNet: n(r.last_payroll_net),
        yearsOfService: n(r.years_of_service),
        indemnifiableYears: n(r.indemnifiable_years),
        cappedBase: n(r.capped_base),
        indemnityYears: n(r.indemnity_years),
        indemnityNotice: n(r.indemnity_notice),
        vacationDaysHabiles: n(r.vacation_days_habiles),
        vacationDaysCorridos: n(r.vacation_days_corridos),
        vacationPay: n(r.vacation_pay),
        totalEarnings: n(r.total_earnings),
        totalDeductions: n(r.total_deductions),
        totalSeverance: n(r.total_severance),
        inputSnapshot: r.input_snapshot || null,
        resultSnapshot: r.result_snapshot || null,
        warnings: r.warnings || [],
        closedAt: r.closed_at || null,
        closedBy: r.closed_by || null,
        closedByName: r.closed_by_name || null,
        paidAt: r.paid_at || null,
        paymentDate: r.payment_date || null,
        paidBy: r.paid_by || null,
        paidByName: r.paid_by_name || null,
        notes: r.notes || null,
        createdBy: r.created_by || null,
        createdByName: r.created_by_name || null,
        createdAt: r.created_at,
    };
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export async function fetchSeverances(tenantId: string): Promise<Severance[]> {
    const { data, error } = await supabase
        .from('severances')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('end_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSeverance);
}

/** Festivos legales (global). Se cachean en memoria: cambian una vez al año. */
let holidayCache: PublicHoliday[] | null = null;
export async function fetchPublicHolidays(): Promise<PublicHoliday[]> {
    if (holidayCache) return holidayCache;
    const { data, error } = await supabase
        .from('public_holidays')
        .select('*')
        .order('holiday_date', { ascending: true });
    if (error) throw error;
    holidayCache = (data || []).map((h: any) => ({
        holidayDate: h.holiday_date,
        name: h.name,
        isIrrenunciable: !!h.is_irrenunciable,
    }));
    return holidayCache;
}

// ── Propuesta (no escribe) ──────────────────────────────────────────────────

export interface SeveranceProposal {
    userId: string;
    userName: string;
    contract: EmploymentContract | null;
    /** Ingreso a la empresa, del perfil o del contrato más antiguo. */
    startDate: string;
    /** Base del art. 172 sugerida, desde el contrato vigente. */
    lastRemuneration: number;
    /** Días de feriado ya tomados, contados desde la asistencia. */
    vacationDaysTaken: number;
    /** Anticipos vigentes que deberían descontarse. */
    pendingAdvances: { name: string; amount: number }[];
    /** Líquido de la planilla del mes de término, si ya existe. */
    lastPayrollRunId: string | null;
    lastPayrollNet: number;
    ufValue: number;
    holidays: string[];
    warnings: string[];
}

/**
 * Reúne todo lo que el finiquito necesita desde donde ya vive, en vez de pedirlo
 * a mano como hacía la calculadora anterior: contrato laboral, asistencia,
 * anticipos y la planilla del último mes.
 */
export async function proposeSeverance(
    userId: string,
    endDate: string,
    { tenantId }: Context,
): Promise<SeveranceProposal> {
    if (!tenantId) throw new Error('Sin inquilino.');
    const warnings: string[] = [];

    const [{ data: profile }, { data: contractRows }, { data: uf }, holidays] = await Promise.all([
        supabase.from('profiles').select('id, name, fecha_ingreso').eq('id', userId).maybeSingle(),
        supabase.from('employment_contracts').select('*')
            .eq('user_id', userId).order('effective_from', { ascending: true }),
        supabase.from('uf_rates').select('value').lte('rate_date', endDate)
            .order('rate_date', { ascending: false }).limit(1).maybeSingle(),
        fetchPublicHolidays(),
    ]);

    const contracts = (contractRows || []).map(mapEmploymentContract);
    const contract = contractAt(contracts, endDate);
    if (!contract) warnings.push('El trabajador no tiene contrato laboral registrado: la base de cálculo hay que ingresarla a mano.');

    // Ingreso a la EMPRESA: el contrato más antiguo, o el perfil. No el anexo
    // vigente — un anexo de junio no reinicia la antigüedad.
    const startDate = contracts[0]?.effectiveFrom
        || (profile?.fecha_ingreso ? String(profile.fecha_ingreso).slice(0, 10) : endDate);
    if (!contracts.length && !profile?.fecha_ingreso)
        warnings.push('Sin fecha de ingreso conocida: la antigüedad quedó en cero. Revísala antes de cerrar.');

    // Días de feriado ya tomados, desde la asistencia (marcas tipo vacaciones).
    const { data: vac } = await supabase
        .from('attendance_logs')
        .select('date')
        .eq('tenant_id', tenantId).eq('user_id', userId)
        .eq('mark_type', 'V')
        .lte('date', endDate);
    // Un día marcado puede tener entrada y salida: se cuentan días distintos.
    const vacationDaysTaken = new Set((vac || []).map((v: any) => v.date)).size;

    // Anticipos vigentes que aún no se descontaron en una planilla.
    const { data: advances } = await supabase
        .from('salary_advances')
        .select('id, amount, request_date, status, payroll_line_id')
        .eq('tenant_id', tenantId).eq('user_id', userId)
        .eq('status', 'aprobado')
        .is('payroll_line_id', null);
    const pendingAdvances = (advances || []).map((a: any) => ({
        name: `Anticipo ${String(a.request_date || '').slice(0, 10)}`,
        amount: n(a.amount),
    }));

    // Liquidación del último mes: se TOMA de la planilla, no se recalcula
    // (decisión de Steven). Si no existe todavía, queda en 0 y se avisa.
    const month = `${endDate.slice(0, 7)}-01`;
    const { data: line } = await supabase
        .from('payroll_lines')
        .select('net_pay, run_id, payroll_runs!inner(period_month, status, tenant_id)')
        .eq('user_id', userId)
        .eq('payroll_runs.tenant_id', tenantId)
        .eq('payroll_runs.period_month', month)
        .maybeSingle();

    const lastPayrollNet = line ? n((line as any).net_pay) : 0;
    const lastPayrollRunId = line ? (line as any).run_id : null;
    if (!line)
        warnings.push(`Todavía no hay planilla del mes ${endDate.slice(0, 7)}: el finiquito no incluye la liquidación del último mes.`);

    const ufValue = uf ? Number(uf.value) : 0;
    if (!ufValue) warnings.push('Sin valor de UF a la fecha de término: no se podrá aplicar el tope de 90 UF.');

    return {
        userId,
        userName: profile?.name || 'Trabajador',
        contract,
        startDate,
        lastRemuneration: contract ? Number(contract.baseSalary) || 0 : 0,
        vacationDaysTaken,
        pendingAdvances,
        lastPayrollRunId,
        lastPayrollNet,
        ufValue,
        holidays: holidays.map((h) => h.holidayDate),
        warnings,
    };
}

// ── Escritura ───────────────────────────────────────────────────────────────

export interface SeveranceDraftInput {
    userId: string;
    userName: string;
    employmentContractId?: string | null;
    startDate: string;
    endDate: string;
    cause: TerminationCause;
    noticeGiven: boolean;
    lastRemuneration: number;
    ufValue: number;
    vacationDaysTaken: number;
    progressiveDays: number;
    deductions: { name: string; amount: number }[];
    lastPayrollRunId?: string | null;
    lastPayrollNet: number;
    holidays: string[];
    contract: EmploymentContract;
    notes?: string | null;
}

function runEngine(input: SeveranceDraftInput): SeveranceResult {
    const engineInput: SeveranceInput = {
        contract: input.contract,
        startDate: input.startDate,
        endDate: input.endDate,
        cause: input.cause,
        noticeGiven: input.noticeGiven,
        lastRemuneration: input.lastRemuneration,
        ufValue: input.ufValue,
        vacationDaysTaken: input.vacationDaysTaken,
        progressiveDays: input.progressiveDays,
        holidays: input.holidays,
        lastPayrollNet: input.lastPayrollNet,
        deductions: input.deductions,
    };
    return calculateSeverance(engineInput);
}

function toRow(input: SeveranceDraftInput, result: SeveranceResult, tenantId: string) {
    return {
        tenant_id: tenantId,
        user_id: input.userId,
        user_name: input.userName,
        employment_contract_id: input.employmentContractId || null,
        start_date: input.startDate,
        end_date: input.endDate,
        cause: input.cause,
        notice_given: input.noticeGiven,
        last_remuneration: input.lastRemuneration,
        uf_value: input.ufValue || null,
        vacation_days_taken: input.vacationDaysTaken,
        progressive_days: input.progressiveDays,
        deductions: input.deductions,
        last_payroll_run_id: input.lastPayrollRunId || null,
        last_payroll_net: input.lastPayrollNet,
        years_of_service: result.yearsOfService,
        indemnifiable_years: result.indemnifiableYears,
        capped_base: result.cappedBase,
        indemnity_years: result.indemnityYears,
        indemnity_notice: result.indemnityNotice,
        vacation_days_habiles: result.vacationDaysHabiles,
        vacation_days_corridos: result.vacationDaysCorridos,
        vacation_pay: result.vacationPay,
        total_earnings: result.totalEarnings,
        total_deductions: result.totalDeductions,
        total_severance: result.totalSeverance,
        // Snapshot: reproducir el documento aunque cambien festivos, UF o contrato.
        input_snapshot: { ...input, contract: input.contract },
        result_snapshot: result,
        warnings: result.warnings,
        notes: input.notes || null,
    };
}

/** Crea el borrador corriendo el motor. */
export async function saveSeveranceDraft(
    input: SeveranceDraftInput,
    { user, tenantId }: Context,
): Promise<{ severance: Severance; result: SeveranceResult }> {
    requireHr(user);
    if (!tenantId) throw new Error('Sin inquilino.');

    const result = runEngine(input);
    const { data, error } = await supabase
        .from('severances')
        .insert({
            ...toRow(input, result, tenantId),
            status: 'borrador',
            created_by: user!.id,
            created_by_name: user!.name,
        })
        .select()
        .single();
    if (error) throw error;
    return { severance: mapSeverance(data), result };
}

/** Recalcula un borrador. Los cerrados los rechaza el trigger de la base. */
export async function recalculateSeveranceDraft(
    id: string,
    input: SeveranceDraftInput,
    { user, tenantId }: Context,
): Promise<{ severance: Severance; result: SeveranceResult }> {
    requireHr(user);
    if (!tenantId) throw new Error('Sin inquilino.');

    const result = runEngine(input);
    const { data, error } = await supabase
        .from('severances')
        .update(toRow(input, result, tenantId))
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    // RLS que no matchea no lanza error: sin fila de vuelta, el UPDATE no ocurrió.
    if (!data) throw new Error('No se pudo actualizar el finiquito (¿sigue siendo borrador?).');
    return { severance: mapSeverance(data), result };
}

/**
 * Cierra el finiquito y lo emite al ledger.
 *
 * El ledger va ANTES del cambio de estado, igual que en la planilla: si el mes de
 * término está contablemente cerrado, la emisión aborta acá y el finiquito sigue
 * siendo un borrador editable, en vez de quedar cerrado (inmutable) con el ledger
 * desactualizado y sin arreglo posible.
 */
export async function closeSeverance(
    id: string,
    { user, tenantId }: Context,
): Promise<Severance> {
    requireHr(user);
    const { data: row, error: rErr } = await supabase
        .from('severances').select('*').eq('id', id).single();
    if (rErr) throw rErr;
    if (row.status !== 'borrador') throw new Error(`El finiquito ya está ${row.status}.`);

    const severance = mapSeverance(row);
    if (!severance.totalSeverance && !severance.totalEarnings)
        throw new Error('No se puede cerrar un finiquito sin montos.');
    if (!severance.ufValue)
        throw new Error(
            'No se puede cerrar sin valor de UF: el tope de 90 UF del art. 172 no se aplicó. '
            + 'Actualiza la UF y vuelve a calcular.',
        );

    const ledger = await emitSeveranceCost(severance, { user, tenantId } as Context);

    const { data, error } = await supabase
        .from('severances')
        .update({
            status: 'cerrado',
            closed_at: new Date().toISOString(),
            closed_by: user!.id,
            closed_by_name: user!.name,
            notes: ledger.withoutContract
                ? 'Costo imputado al pool: el trabajador no tenía días en obra en su último mes.'
                : row.notes,
        })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return mapSeverance(data);
}

/** Marca el pago: apaga la obligación y emite el hecho `paid`. */
export async function markSeverancePaid(
    id: string,
    paymentDate: string,
    { user, tenantId }: Context,
): Promise<Severance> {
    requireHr(user);
    const { data: row, error: rErr } = await supabase
        .from('severances').select('*').eq('id', id).single();
    if (rErr) throw rErr;
    if (row.status !== 'cerrado')
        throw new Error(`Solo un finiquito cerrado se puede marcar como pagado (está ${row.status}).`);

    const { data, error } = await supabase
        .from('severances')
        .update({
            status: 'pagado',
            payment_date: paymentDate,
            paid_at: new Date().toISOString(),
            paid_by: user!.id,
            paid_by_name: user!.name,
        })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;

    await emitSeverancePayment(mapSeverance(data), { user, tenantId } as Context);
    return mapSeverance(data);
}

/** Elimina un borrador. Los cerrados los protege el trigger (Art. 2). */
export async function deleteSeveranceDraft(id: string, { user }: Context): Promise<void> {
    requireHr(user);
    const { error } = await supabase.from('severances').delete().eq('id', id);
    if (error) throw error;
}
