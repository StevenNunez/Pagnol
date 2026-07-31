import { supabase } from '@/modules/core/lib/supabase';
import { userCan } from '@/modules/core/lib/permissions';
import type {
    PayrollRun, PayrollLine, PayrollRunStatus, EmploymentContract,
    PayrollParameters, AfpRate, SalaryAdvance,
} from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';
import { calculatePayroll, type PayrollEarning, type PayrollResult } from './payrollMath';
import {
    fetchAfpRates, fetchPayrollParameters, contractAt, mapEmploymentContract,
} from './payrollMutations';
import { laborDayPresence, type LaborDayLog } from './financeMath';
import { emitPayrollCost, emitPayrollPayment } from './payrollLedger';

// Remuneraciones F3 — planilla persistente (RFC-003 / ADR-009).
//
// Separación deliberada:
//   proposePayrollLines()  consulta y PROPONE (no escribe nada)
//   savePayrollDraft()     corre el motor y persiste el borrador
//   closePayrollRun()      congela el snapshot (Art. 2)
//   markPayrollRunPaid()   registra el pago real
//
// La propuesta no escribe porque las horas extra requieren autorización: en Chile
// no salen de un reloj, se pactan. Las liquidaciones reales muestran 27, 40 y 31
// horas — números que alguien aprobó. El operador revisa antes de guardar.

/** Primer día del mes, que es cómo se guarda el período. */
export function monthStart(month: string): string {
    return `${month.slice(0, 7)}-01`;
}

export function mapPayrollRun(r: any): PayrollRun {
    return {
        id: r.id,
        tenantId: r.tenant_id,
        periodMonth: r.period_month,
        status: r.status,
        parametersSnapshot: r.parameters_snapshot || null,
        ufValue: r.uf_value === null ? null : Number(r.uf_value),
        utmValue: r.utm_value === null ? null : Number(r.utm_value),
        totalTaxable: Number(r.total_taxable) || 0,
        totalEarnings: Number(r.total_earnings) || 0,
        totalDeductions: Number(r.total_deductions) || 0,
        totalNet: Number(r.total_net) || 0,
        totalEmployerCost: Number(r.total_employer_cost) || 0,
        workerCount: Number(r.worker_count) || 0,
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

export function mapPayrollLine(l: any): PayrollLine {
    const n = (v: any) => Number(v) || 0;
    return {
        id: l.id,
        tenantId: l.tenant_id,
        runId: l.run_id,
        userId: l.user_id,
        userName: l.user_name,
        employmentContractId: l.employment_contract_id || null,
        workedDays: n(l.worked_days),
        overtimeHours: n(l.overtime_hours),
        baseSalaryEarned: n(l.base_salary_earned),
        overtimeAmount: n(l.overtime_amount),
        gratification: n(l.gratification),
        totalTaxable: n(l.total_taxable),
        familyAllowance: n(l.family_allowance),
        totalNonTaxable: n(l.total_non_taxable),
        totalEarnings: n(l.total_earnings),
        pensionAmount: n(l.pension_amount),
        pensionCommission: n(l.pension_commission),
        healthAmount: n(l.health_amount),
        healthAdditional: n(l.health_additional),
        unemploymentAmount: n(l.unemployment_amount),
        incomeTax: n(l.income_tax),
        advancesAmount: n(l.advances_amount),
        totalDeductions: n(l.total_deductions),
        netPay: n(l.net_pay),
        employerSis: n(l.employer_sis),
        employerPension: n(l.employer_pension),
        employerUnemployment: n(l.employer_unemployment),
        employerCost: n(l.employer_cost),
        inputSnapshot: l.input_snapshot || null,
        resultSnapshot: l.result_snapshot || null,
        warnings: l.warnings || [],
        createdAt: l.created_at,
    };
}

// ── Lectura ─────────────────────────────────────────────────────────────────

export async function fetchPayrollRuns(tenantId: string): Promise<PayrollRun[]> {
    const { data, error } = await supabase
        .from('payroll_runs')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('period_month', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapPayrollRun);
}

/**
 * Las liquidaciones del trabajador que consulta, con la cabecera de su planilla.
 *
 * `payroll_runs!inner` es deliberado: la RLS deja al trabajador ver la cabecera
 * SOLO si la planilla ya no es borrador, así que el INNER JOIN descarta en la
 * base las líneas de un borrador en ajuste. El filtro lo hace Postgres, no un
 * `if` del cliente — un número que todavía puede cambiar no es una liquidación.
 */
export async function fetchMyPayrollLines(
    userId: string,
): Promise<{ line: PayrollLine; run: PayrollRun }[]> {
    const { data, error } = await supabase
        .from('payroll_lines')
        .select('*, run:payroll_runs!inner(*)')
        .eq('user_id', userId);
    if (error) throw error;
    return (data || [])
        .filter((l: any) => l.run)
        .map((l: any) => ({ line: mapPayrollLine(l), run: mapPayrollRun(l.run) }))
        .sort((a, b) => b.run.periodMonth.localeCompare(a.run.periodMonth));
}

export async function fetchPayrollLines(runId: string): Promise<PayrollLine[]> {
    const { data, error } = await supabase
        .from('payroll_lines')
        .select('*')
        .eq('run_id', runId)
        .order('user_name', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapPayrollLine);
}

// ── Propuesta de líneas ─────────────────────────────────────────────────────

/** Lo que el operador puede ajustar antes de guardar. */
export interface PayrollLineInput {
    userId: string;
    userName: string;
    workedDays: number;
    overtimeHours: number;
    taxableEarnings?: PayrollEarning[];
    nonTaxableEarnings?: PayrollEarning[];
    otherDeductions?: PayrollEarning[];
    /** Anticipos aprobados y sin liquidar que se aplicarán a esta línea. */
    advanceIds?: string[];
    advancesAmount?: number;
    overtimeHourValue?: number | null;
}

export interface PayrollProposal {
    lines: PayrollLineInput[];
    parameters: PayrollParameters | null;
    afps: AfpRate[];
    /** Contrato vigente por trabajador, ya resuelto a la fecha del período. */
    contracts: Record<string, EmploymentContract | null>;
    ufValue: number;
    utmValue: number;
    /** Trabajadores del tenant SIN contrato laboral vigente: no se liquidan. */
    withoutContract: { userId: string; userName: string }[];
    warnings: string[];
}

/**
 * Arma la propuesta del período: quién se liquida, con cuántos días y qué
 * anticipos tiene pendientes. NO escribe nada.
 *
 * Los días trabajados usan el criterio del ledger (ADR-008 §2 / ADR-003): marcas
 * `in` con mark_type nulo o P/ATR/MJ. Es el mismo `laborDayPresence` que alimenta
 * el costo estimado, para que la desviación que F4 va a medir sea plata y no
 * diferencia de criterio.
 */
export async function proposePayrollLines(
    month: string,
    { tenantId }: Context,
): Promise<PayrollProposal> {
    if (!tenantId) throw new Error('Sin inquilino.');
    const start = monthStart(month);
    const endDate = new Date(`${start}T00:00:00`);
    endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.toISOString().slice(0, 10);
    const warnings: string[] = [];

    // Parámetros y catálogos vigentes al ÚLTIMO día del período: una liquidación
    // de marzo se calcula con la paramétrica de marzo.
    const lastDay = new Date(endDate.getTime() - 86400000).toISOString().slice(0, 10);
    const [parameters, afps] = await Promise.all([
        fetchPayrollParameters(lastDay),
        fetchAfpRates(),
    ]);
    if (!parameters) warnings.push(`No hay parámetros legales vigentes para ${month}.`);

    // UF y UTM del período: el último valor disponible dentro del mes.
    const [{ data: uf }, { data: utm }] = await Promise.all([
        supabase.from('uf_rates').select('rate_date,value').lte('rate_date', lastDay)
            .order('rate_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('utm_rates').select('rate_date,value').lte('rate_date', lastDay)
            .order('rate_date', { ascending: false }).limit(1).maybeSingle(),
    ]);
    let ufValue = Number(uf?.value) || 0;
    const utmValue = Number(utm?.value) || 0;

    // 🔴 Sin UF, `taxableCap` devuelve Infinity y el tope imponible NO se aplica:
    // AFP y salud se calcularían sobre la renta completa, descontándole de MÁS al
    // trabajador. Es el error más caro posible y va en la dirección equivocada.
    //
    // `uf_rates` solo cubre ~45 días hacia atrás (es lo que entrega mindicador.cl),
    // así que liquidar un mes histórico se queda sin su UF y no hay forma de
    // recuperarla. Antes que desactivar el tope, se usa la UF más antigua conocida
    // como aproximación —la UF se mueve del orden de 0,3% al mes, así que el tope
    // resultante es casi el correcto— y se DECLARA que es aproximada.
    if (!ufValue) {
        const { data: masAntigua } = await supabase
            .from('uf_rates').select('rate_date,value')
            .order('rate_date', { ascending: true }).limit(1).maybeSingle();
        if (masAntigua?.value) {
            ufValue = Number(masAntigua.value);
            warnings.push(
                `No hay UF registrada para ${month.slice(0, 7)} (la serie parte el ${masAntigua.rate_date}). `
                + `Se usó la UF del ${masAntigua.rate_date} para calcular los topes imponibles: `
                + 'revisa las rentas altas antes de cerrar.',
            );
        } else {
            warnings.push('Sin ningún valor de UF en el sistema: los topes imponibles NO se aplicarán. '
                + 'Actualiza la UF antes de cerrar la planilla.');
        }
    }
    if (!utmValue) warnings.push('Sin valor de UTM para el período: no se calculará impuesto único.');

    // Trabajadores activos del tenant
    const { data: profiles, error: pErr } = await supabase
        .from('profiles').select('id,name').eq('tenant_id', tenantId);
    if (pErr) throw pErr;

    // Contratos laborales: se traen todos y se resuelve el vigente en memoria
    // (la regla vive en contractAt, compartida con la UI y con Postgres).
    const { data: rawContracts, error: cErr } = await supabase
        .from('employment_contracts').select('*').eq('tenant_id', tenantId);
    if (cErr) throw cErr;
    const byUser = new Map<string, EmploymentContract[]>();
    for (const row of rawContracts || []) {
        const c = mapEmploymentContract(row);
        const list = byUser.get(c.userId) || [];
        list.push(c);
        byUser.set(c.userId, list);
    }

    // Asistencia del mes
    const { data: logs, error: aErr } = await supabase
        .from('attendance_logs')
        .select('user_id,type,mark_type,contract_id,timestamp,date')
        .eq('tenant_id', tenantId).gte('date', start).lt('date', end);
    if (aErr) throw aErr;
    const logsByUserDay = new Map<string, LaborDayLog[]>();
    for (const l of logs || []) {
        const key = `${l.user_id}|${l.date}`;
        const arr = logsByUserDay.get(key) || [];
        arr.push({
            type: l.type, markType: l.mark_type,
            contractId: l.contract_id, timestamp: l.timestamp,
        });
        logsByUserDay.set(key, arr);
    }
    const workedByUser = new Map<string, number>();
    for (const [key, dayLogs] of logsByUserDay) {
        if (!laborDayPresence(dayLogs)) continue;
        const userId = key.slice(0, key.indexOf('|'));
        workedByUser.set(userId, (workedByUser.get(userId) || 0) + 1);
    }

    // Anticipos aprobados que NUNCA se descontaron (payroll_line_id NULL).
    // Esta consulta es la que hace imposible el doble descuento del hallazgo 2.
    // La columna es `user_id` (el tipo TS la llama `workerId` — drift #6).
    const { data: advances, error: advErr } = await supabase
        .from('salary_advances')
        .select('id,user_id,amount,status,payroll_line_id')
        .eq('tenant_id', tenantId).eq('status', 'approved').is('payroll_line_id', null);
    if (advErr) throw advErr;
    const advByUser = new Map<string, { ids: string[]; total: number }>();
    for (const a of advances || []) {
        const cur = advByUser.get(a.user_id) || { ids: [], total: 0 };
        cur.ids.push(a.id);
        cur.total += Number(a.amount) || 0;
        advByUser.set(a.user_id, cur);
    }

    const lines: PayrollLineInput[] = [];
    const contracts: Record<string, EmploymentContract | null> = {};
    const withoutContract: { userId: string; userName: string }[] = [];

    for (const p of profiles || []) {
        const vigente = contractAt(byUser.get(p.id) || [], lastDay);
        if (!vigente) {
            // Solo se reporta si tuvo asistencia: alguien trabajó y no tiene
            // contrato laboral registrado. Es un problema de datos, no ruido.
            if ((workedByUser.get(p.id) || 0) > 0) withoutContract.push({ userId: p.id, userName: p.name });
            continue;
        }
        contracts[p.id] = vigente;
        const adv = advByUser.get(p.id);
        lines.push({
            userId: p.id,
            userName: p.name,
            workedDays: workedByUser.get(p.id) || 0,
            overtimeHours: 0,   // requiere autorización: lo completa el operador
            taxableEarnings: [],
            nonTaxableEarnings: [],
            otherDeductions: [],
            advanceIds: adv?.ids || [],
            advancesAmount: adv?.total || 0,
        });
    }

    lines.sort((a, b) => a.userName.localeCompare(b.userName));
    return { lines, parameters, afps, contracts, ufValue, utmValue, withoutContract, warnings };
}

// ── Escritura ───────────────────────────────────────────────────────────────

function requireHr(user: Context['user']) {
    if (!user) throw new Error('No autenticado.');
    if (!userCan(user, 'hr_employees:edit'))
        throw new Error('No tienes permiso para administrar remuneraciones.');
}

/** Crea el borrador del período (uno por mes: lo garantiza el UNIQUE). */
export async function createPayrollRun(
    month: string,
    { user, tenantId }: Context,
): Promise<PayrollRun> {
    requireHr(user);
    if (!tenantId) throw new Error('Sin inquilino.');
    const { data, error } = await supabase
        .from('payroll_runs')
        .insert({
            tenant_id: tenantId,
            period_month: monthStart(month),
            status: 'borrador',
            created_by: user!.id,
            created_by_name: user!.name,
        })
        .select()
        .single();
    if (error) {
        if ((error as any).code === '23505')
            throw new Error(`Ya existe una planilla para ${month.slice(0, 7)}. Ábrela en vez de crear otra.`);
        throw error;
    }
    return mapPayrollRun(data);
}

/**
 * Calcula y persiste las líneas de un BORRADOR. Reemplaza las anteriores
 * (delete + insert): recalcular es idempotente y no deja líneas huérfanas.
 *
 * Devuelve los resultados del motor para que la UI muestre los avisos sin
 * releer.
 */
export async function savePayrollDraft(
    runId: string,
    input: {
        lines: PayrollLineInput[];
        parameters: PayrollParameters;
        afps: AfpRate[];
        contracts: Record<string, EmploymentContract | null>;
        ufValue: number;
        utmValue: number;
    },
    { user, tenantId }: Context,
): Promise<{ run: PayrollRun; results: Record<string, PayrollResult> }> {
    requireHr(user);
    if (!tenantId) throw new Error('Sin inquilino.');

    const { data: run, error: rErr } = await supabase
        .from('payroll_runs').select('*').eq('id', runId).single();
    if (rErr) throw rErr;
    if (run.status !== 'borrador')
        throw new Error(`La planilla ya está ${run.status}: no admite recálculo. Corregirla es crear una nueva.`);

    const afpByName = new Map(input.afps.map((a) => [a.name, a]));
    const results: Record<string, PayrollResult> = {};
    const rows: any[] = [];

    for (const line of input.lines) {
        const contract = input.contracts[line.userId];
        if (!contract) continue;   // sin contrato vigente no se liquida
        const result = calculatePayroll({
            contract,
            attendance: { workedDays: line.workedDays, overtimeHours: line.overtimeHours },
            parameters: input.parameters,
            afp: contract.afpName ? afpByName.get(contract.afpName) ?? null : null,
            ufValue: input.ufValue,
            utmValue: input.utmValue,
            taxableEarnings: line.taxableEarnings || [],
            nonTaxableEarnings: line.nonTaxableEarnings || [],
            advances: line.advancesAmount || 0,
            otherDeductions: line.otherDeductions || [],
            overtimeHourValue: line.overtimeHourValue ?? null,
            // Solo para la advertencia de jornada sobre el máximo legal (ADR-011).
            periodMonth: run.period_month,
        });
        results[line.userId] = result;

        rows.push({
            tenant_id: tenantId,
            run_id: runId,
            user_id: line.userId,
            user_name: line.userName,
            employment_contract_id: contract.id,
            worked_days: line.workedDays,
            overtime_hours: line.overtimeHours,
            base_salary_earned: result.baseSalaryEarned,
            overtime_amount: result.overtimeAmount,
            gratification: result.gratification,
            total_taxable: result.totalTaxable,
            family_allowance: result.familyAllowance,
            total_non_taxable: result.totalNonTaxable,
            total_earnings: result.totalEarnings,
            pension_amount: result.pensionAmount,
            pension_commission: result.pensionCommission,
            health_amount: result.healthAmount,
            health_additional: result.healthAdditional,
            unemployment_amount: result.unemploymentAmount,
            income_tax: result.incomeTax,
            advances_amount: result.advances,
            total_deductions: result.totalDeductions,
            net_pay: result.netPay,
            employer_sis: result.employerSis,
            employer_pension: result.employerPension,
            employer_unemployment: result.employerUnemployment,
            employer_cost: result.employerCost,
            // Snapshot: permite reproducir exactamente lo que se emitió (ADR-009 §4)
            input_snapshot: {
                workedDays: line.workedDays,
                overtimeHours: line.overtimeHours,
                taxableEarnings: line.taxableEarnings || [],
                nonTaxableEarnings: line.nonTaxableEarnings || [],
                otherDeductions: line.otherDeductions || [],
                advanceIds: line.advanceIds || [],
                contract,
                ufValue: input.ufValue,
                utmValue: input.utmValue,
            },
            result_snapshot: result,
            warnings: result.warnings,
        });
    }

    // Reemplazo completo. Los anticipos se sueltan primero: el ON DELETE SET NULL
    // los liberaría igual, pero hacerlo explícito evita depender del orden.
    const { data: oldLines } = await supabase
        .from('payroll_lines').select('id').eq('run_id', runId);
    if (oldLines?.length) {
        const ids = oldLines.map((l: any) => l.id);
        await supabase.from('salary_advances').update({ payroll_line_id: null }).in('payroll_line_id', ids);
        const { error: delErr } = await supabase.from('payroll_lines').delete().eq('run_id', runId);
        if (delErr) throw delErr;
    }

    let inserted: any[] = [];
    if (rows.length) {
        const { data, error: insErr } = await supabase.from('payroll_lines').insert(rows).select();
        if (insErr) throw insErr;
        inserted = data || [];
    }

    // Amarrar los anticipos a la línea que los descontó (ADR-009 §3)
    for (const row of inserted) {
        const ids: string[] = row.input_snapshot?.advanceIds || [];
        if (!ids.length) continue;
        const { error: advErr } = await supabase
            .from('salary_advances').update({ payroll_line_id: row.id }).in('id', ids);
        if (advErr) throw advErr;
    }

    const totals = inserted.reduce((acc, r: any) => ({
        taxable: acc.taxable + Number(r.total_taxable),
        earnings: acc.earnings + Number(r.total_earnings),
        deductions: acc.deductions + Number(r.total_deductions),
        net: acc.net + Number(r.net_pay),
        employer: acc.employer + Number(r.employer_cost),
    }), { taxable: 0, earnings: 0, deductions: 0, net: 0, employer: 0 });

    const { data: updated, error: upErr } = await supabase
        .from('payroll_runs')
        .update({
            total_taxable: totals.taxable,
            total_earnings: totals.earnings,
            total_deductions: totals.deductions,
            total_net: totals.net,
            total_employer_cost: totals.employer,
            worker_count: inserted.length,
            uf_value: input.ufValue,
            utm_value: input.utmValue,
        })
        .eq('id', runId)
        .select()
        .single();
    if (upErr) throw upErr;
    return { run: mapPayrollRun(updated), results };
}

/**
 * Cierra la planilla: congela el snapshot, la vuelve inmutable y **reemplaza la
 * estimación del ledger por el costo real** (F4 / ADR-010).
 *
 * El orden importa: primero se emite al ledger y solo si eso funciona se marca
 * cerrada. Al revés, una planilla podría quedar cerrada (inmutable) con el ledger
 * sin actualizar, y ya no habría forma de arreglarlo sin reabrir el período.
 */
export async function closePayrollRun(
    runId: string,
    parameters: PayrollParameters,
    { user, tenantId }: Context,
): Promise<PayrollRun> {
    requireHr(user);
    const { data: run, error: rErr } = await supabase
        .from('payroll_runs').select('*').eq('id', runId).single();
    if (rErr) throw rErr;
    if (run.status !== 'borrador')
        throw new Error(`La planilla ya está ${run.status}.`);
    if (!run.worker_count)
        throw new Error('No se puede cerrar una planilla sin líneas.');
    // Sin UF el tope imponible no se aplicó y las cotizaciones de las rentas
    // altas quedarían sobrestimadas. Cerrar así emitiría liquidaciones que
    // descuentan de más — y una vez cerradas son inmutables.
    if (!Number(run.uf_value))
        throw new Error(
            'No se puede cerrar sin valor de UF: los topes imponibles no se aplicaron. '
            + 'Actualiza la UF (Configuración → Actualizar UF) y vuelve a calcular.',
        );

    // F4: el costo real reemplaza la estimación. Va ANTES del cambio de estado —
    // si el período contable del mes está cerrado, la RPC aborta acá y la planilla
    // sigue siendo un borrador editable en vez de quedar cerrada con el ledger
    // desactualizado y sin arreglo posible.
    const full = mapPayrollRun({ ...run, id: runId });
    const lines = await fetchPayrollLines(runId);
    const ledger = await emitPayrollCost(full, lines, { user, tenantId } as Context);

    const { data, error } = await supabase
        .from('payroll_runs')
        .update({
            status: 'cerrada',
            parameters_snapshot: parameters,
            closed_at: new Date().toISOString(),
            closed_by: user!.id,
            closed_by_name: user!.name,
            notes: ledger.withoutContract.length
                ? `Costo sin obra imputada: ${ledger.withoutContract.join(', ')}`
                : null,
        })
        .eq('id', runId)
        .select()
        .single();
    if (error) throw error;
    return mapPayrollRun(data);
}

/**
 * Registra el pago real: apaga la obligación de caja y emite el hecho `paid`
 * (F4 / ADR-010). El estado se cambia PRIMERO porque el trigger de la base es el
 * que valida la transición; si el ledger falla después, la planilla queda pagada
 * con la obligación viva — se reporta y se puede reintentar, que es preferible a
 * un pago registrado a medias en el estado.
 */
export async function markPayrollRunPaid(
    runId: string,
    paymentDate: string,
    { user, tenantId }: Context,
): Promise<PayrollRun> {
    requireHr(user);
    if (!paymentDate) throw new Error('Falta la fecha de pago.');
    const { data, error } = await supabase
        .from('payroll_runs')
        .update({
            status: 'pagada',
            payment_date: paymentDate,
            paid_at: new Date().toISOString(),
            paid_by: user!.id,
            paid_by_name: user!.name,
        })
        .eq('id', runId)
        .select()
        .single();
    if (error) throw error;
    // RLS que no matchea no lanza: sin fila de vuelta, el UPDATE no ocurrió.
    if (!data) throw new Error('No se pudo marcar como pagada (¿permisos o estado?).');

    const paid = mapPayrollRun(data);
    const lines = await fetchPayrollLines(runId);
    await emitPayrollPayment(paid, lines, { user, tenantId } as Context);
    return paid;
}

/** Elimina un borrador. El trigger rechaza cerradas y pagadas. */
export async function deletePayrollRun(runId: string, { user }: Context): Promise<void> {
    requireHr(user);
    const { error } = await supabase.from('payroll_runs').delete().eq('id', runId);
    if (error) throw error;
}
