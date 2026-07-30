import { supabase } from '@/modules/core/lib/supabase';
import { userCan } from '@/modules/core/lib/permissions';
import type {
    EmploymentContract, AfpRate, PayrollParameters,
} from '@/modules/core/lib/data';
import type { MutationContext as Context } from './context';

// Remuneraciones F1 — fundación de datos (RFC-003).
//
// Contrato LABORAL del trabajador (distinto del contrato de OBRA con el
// cliente, que en Pagnol es `contracts`). Append-only: un anexo —cambio de
// sueldo, de AFP, de jornada— es una fila NUEVA con su vigencia, jamás un
// UPDATE. Así, liquidar marzo con las condiciones de marzo sale del propio
// esquema (Art. 2).
//
// Acá no se calcula nada: el motor es F2 (`payrollMath.ts`, puro y testeado).

export function mapEmploymentContract(item: any): EmploymentContract {
    return {
        id: item.id,
        tenantId: item.tenant_id,
        userId: item.user_id,
        effectiveFrom: item.effective_from,
        contractType: item.contract_type,
        contractEndDate: item.contract_end_date || null,
        salaryMode: item.salary_mode,
        baseSalary: Number(item.base_salary) || 0,
        workSchedule: item.work_schedule || null,
        weeklyHours: Number(item.weekly_hours) || 44,
        afpName: item.afp_name || null,
        healthSystem: item.health_system,
        healthPlanUf: item.health_plan_uf === null ? null : Number(item.health_plan_uf),
        familyCharges: Number(item.family_charges) || 0,
        hasGratification: !!item.has_gratification,
        gratificationBase: item.gratification_base || 'imponible',
        notes: item.notes || null,
        createdBy: item.created_by || null,
        createdByName: item.created_by_name || null,
        createdAt: item.created_at,
    };
}

/**
 * Registra un contrato laboral o un anexo (es lo mismo: una versión nueva).
 *
 * Valida en el cliente lo que la base también exige, para dar un mensaje útil
 * en vez de un error de constraint: Isapre sin plan en UF rompería el cálculo
 * en silencio (quedaría cotizando el 7% legal cuando el plan vale más).
 */
export async function addEmploymentContract(
    data: Omit<EmploymentContract, 'id' | 'tenantId' | 'createdBy' | 'createdByName' | 'createdAt'>,
    { user, tenantId }: Context,
): Promise<EmploymentContract> {
    if (!user || !tenantId) throw new Error('No autenticado o sin inquilino.');
    if (!userCan(user, 'hr_employees:edit'))
        throw new Error('No tienes permiso para administrar contratos laborales.');

    if (!data.userId) throw new Error('Falta el trabajador.');
    if (!data.effectiveFrom) throw new Error('Falta la fecha desde la que rige el contrato.');
    if (!(Number(data.baseSalary) > 0)) throw new Error('El sueldo base debe ser mayor que 0.');
    if (data.healthSystem === 'isapre' && !(Number(data.healthPlanUf) > 0))
        throw new Error('Un contrato con Isapre necesita el valor del plan en UF (el 7% legal es solo el piso).');
    if (data.contractType !== 'indefinido' && !data.contractEndDate)
        throw new Error('Un contrato a plazo fijo o por obra necesita fecha de término.');
    if (data.contractEndDate && data.contractEndDate < data.effectiveFrom)
        throw new Error('La fecha de término no puede ser anterior a la vigencia.');

    const { data: inserted, error } = await supabase
        .from('employment_contracts')
        .insert({
            tenant_id: tenantId,
            user_id: data.userId,
            effective_from: data.effectiveFrom,
            contract_type: data.contractType,
            contract_end_date: data.contractEndDate || null,
            salary_mode: data.salaryMode,
            base_salary: Math.round(Number(data.baseSalary)),
            work_schedule: data.workSchedule || null,
            weekly_hours: Number(data.weeklyHours) || 44,
            afp_name: data.afpName || null,
            health_system: data.healthSystem,
            health_plan_uf: data.healthSystem === 'isapre' ? Number(data.healthPlanUf) : null,
            family_charges: Number(data.familyCharges) || 0,
            has_gratification: data.hasGratification !== false,
            gratification_base: data.gratificationBase || 'imponible',
            notes: data.notes || null,
            created_by: user.id,
            created_by_name: user.name,
        })
        .select()
        .single();

    if (error) {
        // El UNIQUE (user_id, effective_from) es el caso más probable y su
        // mensaje crudo no dice nada útil.
        if ((error as any).code === '23505')
            throw new Error('Ya existe una versión del contrato de este trabajador con esa misma fecha de vigencia.');
        throw error;
    }
    return mapEmploymentContract(inserted);
}

/** Historial completo de un trabajador, del más reciente al más antiguo. */
export async function fetchEmploymentContracts(userId: string): Promise<EmploymentContract[]> {
    const { data, error } = await supabase
        .from('employment_contracts')
        .select('*')
        .eq('user_id', userId)
        .order('effective_from', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapEmploymentContract);
}

/**
 * Contrato vigente en una fecha: el de mayor `effectiveFrom <= fecha`.
 * Puro, para que la UI no consulte la base por cada fila y para que la regla
 * sea la misma que `employment_contract_at()` en Postgres.
 */
export function contractAt(
    contracts: EmploymentContract[],
    date: string,
): EmploymentContract | null {
    let best: EmploymentContract | null = null;
    for (const c of contracts) {
        if (c.effectiveFrom > date) continue;
        if (!best || c.effectiveFrom > best.effectiveFrom) best = c;
    }
    return best;
}

// ── Catálogos y paramétrica (globales, solo lectura desde el cliente) ────────

export async function fetchAfpRates(): Promise<AfpRate[]> {
    const { data, error } = await supabase
        .from('afp_rates')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });
    if (error) throw error;
    return (data || []).map((r: any) => ({
        id: r.id,
        name: r.name,
        commissionRate: Number(r.commission_rate) || 0,
        sisRate: r.sis_rate === null ? null : Number(r.sis_rate),
        effectiveFrom: r.effective_from,
        isActive: !!r.is_active,
    }));
}

/** Parámetros legales vigentes en una fecha (los de mayor vigencia <= fecha). */
export async function fetchPayrollParameters(date: string): Promise<PayrollParameters | null> {
    const { data, error } = await supabase
        .from('payroll_parameters')
        .select('*')
        .lte('effective_from', date)
        .order('effective_from', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
        id: data.id,
        effectiveFrom: data.effective_from,
        minimumWage: Number(data.minimum_wage) || 0,
        capPensionUf: Number(data.cap_pension_uf) || 0,
        capUnemploymentUf: Number(data.cap_unemployment_uf) || 0,
        pensionRate: Number(data.pension_rate) || 10,
        healthRate: Number(data.health_rate) || 7,
        afcIndefiniteWorker: Number(data.afc_indefinite_worker) || 0,
        afcIndefiniteEmployer: Number(data.afc_indefinite_employer) || 0,
        afcFixedEmployer: Number(data.afc_fixed_employer) || 0,
        gratificationRate: Number(data.gratification_rate) || 25,
        gratificationCapImm: Number(data.gratification_cap_imm) || 4.75,
        familyAllowanceBrackets: data.family_allowance_brackets || [],
        incomeTaxBrackets: data.income_tax_brackets || [],
        notes: data.notes || null,
    };
}
