import type {
    EmploymentContract, PayrollParameters, AfpRate,
    FamilyAllowanceBracket, IncomeTaxBracket,
} from '@/modules/core/lib/data';

// =============================================================================
// Remuneraciones F2 — Motor de liquidación (RFC-003 / ADR-008)
//
// Puro: sin Supabase, sin fechas implícitas, sin `new Date()`. Todo lo que el
// cálculo necesita entra por parámetro —incluidos la UF y la UTM del período—
// para que un test sea reproducible y para que liquidar marzo con las tasas de
// marzo sea responsabilidad de quien llama, no un efecto secundario.
//
// Reemplaza la aritmética de `attendance/monthly-report/page.tsx`, que además de
// no persistir nada tenía conceptos legales AUSENTES (tope imponible, impuesto
// único, asignación familiar, AFC por tipo de contrato, plan de Isapre) y
// errores en lo que sí calculaba (IMM desactualizado alimentando el tope de
// gratificación, jornada hardcodeada en `sueldo / 180`, el 10% previsional
// mezclado con la comisión de AFP, y las ausencias sin descontar).
//
// ⚠️ DEUDA VIVA: las tasas, topes y tramos vienen de `payroll_parameters`, cuya
// semilla son VALORES DE REFERENCIA sin verificar contra normativa. El motor es
// correcto en su mecánica; los números que produzca no son válidos para emitir
// hasta cerrar esa verificación. Lo mismo aplica a las dos constantes de hora
// extra de más abajo.
// =============================================================================

/** Autor de sistema de los hechos de remuneración (Art. 5). */
export const PAYROLL_SYSTEM_AUTHOR = 'Sistema (remuneraciones)';

/**
 * Hora extra. VALIDADO contra liquidaciones reales (feb y mar 2026):
 *
 *   valor hora extra = (sueldo mensual / 30) × (7 / jornada semanal) × recargo
 *
 * Con sueldo 900.000 y jornada 44 da un factor de 0,0079545 → $7.159,05 la hora,
 * que es exactamente lo que pagaron ambas liquidaciones (40 h = $286.362 y
 * 31 h = $221.931). Se calcula sobre el sueldo mensual CONTRACTUAL, no sobre el
 * proporcional del mes: en marzo, con 16 días trabajados, la hora extra siguió
 * valiendo lo mismo.
 *
 * El factor se redondea a 7 decimales porque así se publica y así lo aplicó la
 * liquidación real: sin ese redondeo el resultado se va 1-2 pesos.
 *
 * Siguen siendo constantes exportadas y sobreescribibles por input
 * (`overtimeHourValue`) porque son normativa —no aritmética— y la jornada legal
 * chilena está en transición. Quemarlas es el error que tenía `sueldo / 180`.
 */
export const OVERTIME_WEEK_DAYS = 7;
export const OVERTIME_MONTH_DAYS = 30;
export const OVERTIME_SURCHARGE = 1.5;
/** Decimales del factor publicado. Reproduce el redondeo de la liquidación real. */
export const OVERTIME_FACTOR_DECIMALS = 7;

/**
 * Jornada ordinaria máxima legal, por tramo de vigencia (Ley 21.561, "40 horas").
 *
 * Va acá y no en `payroll_parameters` porque su calendario cambia en una FECHA
 * EXACTA (26 de abril), no al inicio de un mes como el resto de la paramétrica:
 * modelarla como una versión mensual más habría dado un falso positivo a quien
 * liquide abril de 2026, que es un mes partido.
 *
 * Solo se usa para ADVERTIR: la jornada que manda en el cálculo es siempre la
 * pactada en el contrato. Un contrato que quedó en 44 h después del 26-04-2026
 * paga la hora extra un 4,8% más barata de lo que debería —la ley prohíbe rebajar
 * la remuneración al reducir la jornada—, y eso es plata del trabajador.
 */
export const LEGAL_MAX_WEEKLY_HOURS: ReadonlyArray<{ from: string; hours: number }> = [
    { from: '0000-01-01', hours: 45 },
    { from: '2024-04-26', hours: 44 },
    { from: '2026-04-26', hours: 42 },
    { from: '2028-04-26', hours: 40 },
];

/** Jornada máxima legal vigente en una fecha `YYYY-MM-DD`. */
export function legalMaxWeeklyHours(date: string): number {
    let hours = LEGAL_MAX_WEEKLY_HOURS[0].hours;
    for (const tramo of LEGAL_MAX_WEEKLY_HOURS) {
        if (date >= tramo.from) hours = tramo.hours;
    }
    return hours;
}

/** Último día del período (`YYYY-MM` o `YYYY-MM-DD` → `YYYY-MM-DD`). */
export function endOfPeriod(period: string): string {
    const m = /^(\d{4})-(\d{2})/.exec(period || '');
    if (!m) return period;
    // Día 0 del mes siguiente = último del mes pedido (el mes va 1-indexed acá y
    // 0-indexed en Date.UTC, así que pasarlo tal cual ya apunta al siguiente).
    const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
    return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`;
}

// ── Entradas ────────────────────────────────────────────────────────────────

export interface PayrollEarning {
    name: string;
    /** Monto MENSUAL si `prorate`; monto final del período si no. */
    amount: number;
    /**
     * Si el haber se prorratea por días trabajados (ADR-009 §2). Las
     * liquidaciones reales prorratean movilización y colación —feb 30 días
     * $69.920 → mar 16 días $37.291, exactamente ×16/30— pero NO el desgaste de
     * herramientas ni los bonos ocasionales. Default `false`: quien no lo declara
     * está pasando un monto ya final.
     */
    prorate?: boolean;
}

/** Resumen de asistencia del período, ya derivado de las marcas. */
export interface PayrollAttendance {
    /** Días que devengan sueldo. Criterio del ledger (ADR-008 §2): marcas
     *  P/ATR/MJ; A/D/LM/PSG/V/PP no devengan. Lo calcula el llamador con
     *  `laborDayPresence` para que liquidación y ledger cuenten igual. */
    workedDays: number;
    /** Horas extra del período (las que ya se aprobaron como tales). */
    overtimeHours: number;
}

export interface PayrollInput {
    contract: EmploymentContract;
    attendance: PayrollAttendance;
    parameters: PayrollParameters;
    /** AFP del contrato, resuelta desde el catálogo. null ⇒ sin AFP (se avisa). */
    afp: AfpRate | null;
    /** Valor de la UF del período: convierte los topes y el plan de Isapre. */
    ufValue: number;
    /** Valor de la UTM del período: convierte los tramos del impuesto único. */
    utmValue: number;
    /** Haberes variables capturados al armar la planilla (ADR-008 §3). */
    taxableEarnings?: PayrollEarning[];
    nonTaxableEarnings?: PayrollEarning[];
    /** Anticipos ya entregados (Wallet). Se descuentan del líquido. */
    advances?: number;
    otherDeductions?: PayrollEarning[];
    /** Valor de la hora extra pactado, si difiere del legal. */
    overtimeHourValue?: number | null;
    /** Mes liquidado (`YYYY-MM` o `YYYY-MM-DD`). Opcional y usado SOLO para
     *  advertencias normativas con fecha —hoy, la jornada máxima legal—: ningún
     *  monto depende de él, así que omitirlo no cambia el cálculo. */
    periodMonth?: string | null;
}

// ── Salida ──────────────────────────────────────────────────────────────────

export interface PayrollResult {
    // Haberes imponibles
    baseSalaryEarned: number;
    overtimeAmount: number;
    overtimeHourValue: number;
    gratification: number;
    taxableEarnings: PayrollEarning[];
    totalTaxable: number;
    // Haberes no imponibles
    familyAllowance: number;
    nonTaxableEarnings: PayrollEarning[];
    totalNonTaxable: number;
    totalEarnings: number;
    // Descuentos legales
    /** Base imponible después del tope (AFP y salud). */
    cappedTaxableBase: number;
    pensionAmount: number;
    pensionCommission: number;
    healthAmount: number;
    /** Isapre: lo que el plan excede al 7% legal, de cargo del trabajador. */
    healthAdditional: number;
    unemploymentAmount: number;
    totalLegalDeductions: number;
    // Impuesto
    taxableIncomeForTax: number;
    incomeTax: number;
    // Otros
    advances: number;
    otherDeductions: PayrollEarning[];
    totalDeductions: number;
    netPay: number;
    // Costo empleador (insumo de F4: el costo REAL que reemplaza la estimación)
    /** SIS cuando se cotiza por separado. 0 desde ago-2026: va dentro del aporte. */
    employerSis: number;
    /** Aporte previsional de cargo del empleador (Ley 21.735). */
    employerPension: number;
    employerUnemployment: number;
    employerCost: number;
    /** Datos incompletos o supuestos que el usuario debe ver. No son errores:
     *  el cálculo sigue, pero la planilla no debería cerrarse a ciegas. */
    warnings: string[];
}

// ── Piezas puras (exportadas para poder testearlas de a una) ────────────────

const round = (n: number) => Math.round(n);

/**
 * Sueldo devengado según modalidad (dotación mixta, decisión 4 del RFC-003).
 *
 * `monthly`: sueldo/30 × días trabajados. El divisor 30 es el mismo de
 * `laborDayCost` en el ledger — cambiarlo acá haría que la desviación de F4
 * midiera criterio en vez de plata.
 * `daily`: valor día × días trabajados, sin proporcionalizar (el valor día YA es
 * la unidad).
 */
export function earnedBaseSalary(
    baseSalary: number,
    salaryMode: 'monthly' | 'daily',
    workedDays: number,
): number {
    if (!Number.isFinite(baseSalary) || baseSalary <= 0) return 0;
    if (!Number.isFinite(workedDays) || workedDays <= 0) return 0;
    if (salaryMode === 'daily') return round(baseSalary * workedDays);
    // Un mes completo no debe pagar de más por tener 31 días marcados.
    return round((baseSalary / 30) * Math.min(workedDays, 30));
}

/**
 * Monto efectivo de un haber en el período: prorrateado por días trabajados si
 * así se declaró, con el mismo divisor 30 del sueldo (ADR-009 §2).
 * Reproduce las liquidaciones reales: $69.920 mensuales con 16 días = $37.291.
 */
export function earningAmount(earning: PayrollEarning, workedDays: number): number {
    const amount = Number(earning.amount) || 0;
    if (!earning.prorate) return round(amount);
    if (!Number.isFinite(workedDays) || workedDays <= 0) return 0;
    return round((amount / 30) * Math.min(workedDays, 30));
}

/** Suma de haberes ya resueltos (prorrateados los que corresponda). */
export function sumEarnings(earnings: PayrollEarning[], workedDays: number): number {
    return (earnings || []).reduce((s, e) => s + earningAmount(e, workedDays), 0);
}

/**
 * Valor de una hora extra: (sueldo / 30) × (7 / jornada) × recargo, con el factor
 * redondeado a 7 decimales. Ver la nota de las constantes: está validado contra
 * dos liquidaciones reales.
 */
export function overtimeHourValue(
    baseSalary: number,
    weeklyHours: number,
    salaryMode: 'monthly' | 'daily' = 'monthly',
): number {
    if (!Number.isFinite(baseSalary) || baseSalary <= 0) return 0;
    if (!Number.isFinite(weeklyHours) || weeklyHours <= 0) return 0;
    // En modalidad diaria la hora se deriva del equivalente mensual (valor día × 30):
    // sin eso, un sueldo por día daría una hora extra ~30 veces menor.
    const monthly = salaryMode === 'daily' ? baseSalary * OVERTIME_MONTH_DAYS : baseSalary;
    const raw = (OVERTIME_WEEK_DAYS / (OVERTIME_MONTH_DAYS * weeklyHours)) * OVERTIME_SURCHARGE;
    const p = 10 ** OVERTIME_FACTOR_DECIMALS;
    return monthly * (Math.round(raw * p) / p);
}

/**
 * Gratificación art. 50: 25% de la base pactada, con tope (capImm × IMM) / 12.
 *
 * La base NUNCA se incluye a sí misma (ADR-008 §1): con base `imponible` es
 * sueldo proporcional + extras + haberes imponibles, y la gratificación se suma
 * después. Incluirla haría que el resultado dependiera del orden de evaluación.
 *
 * ⚠️ El IMM del tope NO es el sueldo mínimo del mes (ADR-011). La Dirección del
 * Trabajo lo determina con el ingreso mínimo vigente al 31 de DICIEMBRE del
 * ejercicio comercial, porque es ahí donde se cierra el ejercicio y se determinan
 * las utilidades: durante todo 2026 son $529.000, aunque el sueldo mínimo del mes
 * ya vaya en $553.553. Usar el del mes inflaría el tope y pagaría de más.
 * `minimumWage` queda como respaldo solo para paramétricas anteriores a la
 * separación de los campos.
 */
export function gratificationAmount(
    base: number,
    params: Pick<PayrollParameters, 'gratificationRate' | 'gratificationCapImm' | 'minimumWage' | 'gratificationImm'>,
): number {
    if (!Number.isFinite(base) || base <= 0) return 0;
    const raw = base * (params.gratificationRate / 100);
    const imm = params.gratificationImm && params.gratificationImm > 0
        ? params.gratificationImm
        : params.minimumWage;
    const monthlyCap = (params.gratificationCapImm * imm) / 12;
    return round(Math.min(raw, monthlyCap));
}

/** Tope imponible en pesos: UF del tope × valor UF del período. */
export function taxableCap(capUf: number, ufValue: number): number {
    if (!Number.isFinite(capUf) || capUf <= 0) return Infinity;
    if (!Number.isFinite(ufValue) || ufValue <= 0) return Infinity;
    return capUf * ufValue;
}

/**
 * Cotización de salud. El 7% (o lo que diga `healthRate`) es el PISO legal:
 * con Isapre, si el plan pactado en UF vale más, el trabajador paga el plan y la
 * diferencia se muestra aparte —es lo que la liquidación llama "adicional".
 * Si el plan vale menos que el piso, se cotiza el piso.
 */
export function healthContribution(
    cappedBase: number,
    params: Pick<PayrollParameters, 'healthRate'>,
    healthSystem: 'fonasa' | 'isapre',
    healthPlanUf: number | null | undefined,
    ufValue: number,
): { legal: number; additional: number; total: number } {
    const legal = round(cappedBase * (params.healthRate / 100));
    if (healthSystem !== 'isapre' || !healthPlanUf || healthPlanUf <= 0) {
        return { legal, additional: 0, total: legal };
    }
    const plan = round(healthPlanUf * ufValue);
    if (plan <= legal) return { legal, additional: 0, total: legal };
    return { legal, additional: plan - legal, total: plan };
}

/**
 * Seguro de cesantía. El trabajador solo aporta con contrato INDEFINIDO; a plazo
 * fijo y por obra el costo es íntegramente del empleador (por eso la calculadora
 * anterior, que fijaba 0,6% para todos, descontaba de más a la mitad de la
 * dotación). Tiene su propio tope, distinto al de AFP/salud.
 */
export function unemploymentContribution(
    taxableTotal: number,
    params: Pick<PayrollParameters, 'capUnemploymentUf' | 'afcIndefiniteWorker' | 'afcIndefiniteEmployer' | 'afcFixedEmployer'>,
    contractType: 'indefinido' | 'plazo_fijo' | 'por_obra',
    ufValue: number,
): { worker: number; employer: number } {
    const cap = taxableCap(params.capUnemploymentUf, ufValue);
    const base = Math.min(taxableTotal, cap);
    if (contractType === 'indefinido') {
        return {
            worker: round(base * (params.afcIndefiniteWorker / 100)),
            employer: round(base * (params.afcIndefiniteEmployer / 100)),
        };
    }
    return { worker: 0, employer: round(base * (params.afcFixedEmployer / 100)) };
}

/**
 * Asignación familiar: monto POR CARGA según el tramo de renta. Es un haber NO
 * imponible (lo paga el empleador y el Estado se lo reembolsa), no un descuento.
 * El último tramo suele traer `max_income: null` y monto 0 = sin derecho.
 */
export function familyAllowance(
    taxableTotal: number,
    charges: number,
    brackets: FamilyAllowanceBracket[],
): number {
    if (!Number.isFinite(charges) || charges <= 0) return 0;
    if (!brackets?.length) return 0;
    // Orden defensivo: no se confía en que la jsonb venga ordenada.
    const sorted = [...brackets].sort((a, b) => {
        if (a.max_income === null) return 1;
        if (b.max_income === null) return -1;
        return a.max_income - b.max_income;
    });
    const bracket = sorted.find((b) => b.max_income === null || taxableTotal <= b.max_income);
    return round((bracket?.amount ?? 0) * charges);
}

/**
 * Impuesto único de 2ª categoría, método chileno de tramos: la renta tributable
 * se lleva a UTM, se ubica el tramo y se aplica `base × factor − rebaja`, con la
 * rebaja también expresada en UTM.
 *
 * La base es la renta imponible MENOS las cotizaciones previsionales: son
 * rebajables, y usar el imponible bruto cobraría impuesto de más.
 */
export function incomeTax(
    taxableIncome: number,
    brackets: IncomeTaxBracket[],
    utmValue: number,
): number {
    if (!Number.isFinite(taxableIncome) || taxableIncome <= 0) return 0;
    if (!Number.isFinite(utmValue) || utmValue <= 0) return 0;
    if (!brackets?.length) return 0;

    const inUtm = taxableIncome / utmValue;
    const sorted = [...brackets].sort((a, b) => a.from_utm - b.from_utm);
    const bracket = sorted.find(
        (b) => inUtm > b.from_utm && (b.to_utm === null || inUtm <= b.to_utm),
    );
    if (!bracket || bracket.factor <= 0) return 0;

    const tax = taxableIncome * bracket.factor - bracket.deduction_utm * utmValue;
    return tax > 0 ? round(tax) : 0;
}

// ── El motor ────────────────────────────────────────────────────────────────

/**
 * Liquidación completa de un trabajador para un período.
 *
 * Orden del cálculo (importa, y por eso está explícito):
 *   1. sueldo proporcional por días devengados
 *   2. horas extra
 *   3. haberes imponibles variables
 *   4. gratificación sobre la base pactada — sin incluirse a sí misma
 *   5. total imponible → se le aplica el tope en UF
 *   6. cotizaciones: AFP (10% + comisión), salud (7% o plan), AFC (según contrato)
 *   7. renta tributable = imponible − cotizaciones → impuesto único
 *   8. asignación familiar y demás no imponibles (haberes, no descuentos)
 *   9. líquido = haberes − descuentos − impuesto − anticipos
 */
export function calculatePayroll(input: PayrollInput): PayrollResult {
    const {
        contract, attendance, parameters, afp, ufValue, utmValue,
        taxableEarnings = [], nonTaxableEarnings = [],
        advances = 0, otherDeductions = [], overtimeHourValue: overrideHourValue,
    } = input;
    const warnings: string[] = [];

    if (!(ufValue > 0)) warnings.push('Sin valor de UF para el período: los topes imponibles no se aplicaron.');
    if (!(utmValue > 0)) warnings.push('Sin valor de UTM para el período: no se calculó impuesto único.');
    if (!afp) warnings.push('El contrato no tiene AFP asignada: no se descontó cotización previsional.');
    if (attendance.workedDays <= 0) warnings.push('Sin días trabajados en el período.');
    if (contract.healthSystem === 'isapre' && !contract.healthPlanUf)
        warnings.push('Isapre sin plan en UF: se cotizó solo el 7% legal.');

    // Jornada sobre el máximo legal: no altera ningún monto —manda lo pactado—
    // pero abarata la hora extra, así que el usuario tiene que verlo. Se evalúa
    // con el ÚLTIMO día del período: la jornada bajó el 26 de abril, a mitad de
    // mes, y avisar por abril completo sería un falso positivo.
    if (input.periodMonth) {
        const finDePeriodo = endOfPeriod(input.periodMonth);
        const maxLegal = legalMaxWeeklyHours(finDePeriodo);
        if (contract.weeklyHours > maxLegal) {
            warnings.push(
                `La jornada del contrato (${contract.weeklyHours} h) supera el máximo legal vigente (${maxLegal} h): `
                + 'la hora extra queda por debajo de lo que corresponde. Requiere anexo de contrato.',
            );
        }
    }

    // ── 1-3. Haberes imponibles del período
    const baseSalaryEarned = earnedBaseSalary(contract.baseSalary, contract.salaryMode, attendance.workedDays);

    const hourValue = overrideHourValue && overrideHourValue > 0
        ? overrideHourValue
        : overtimeHourValue(contract.baseSalary, contract.weeklyHours, contract.salaryMode);
    const overtimeAmount = round(hourValue * Math.max(0, attendance.overtimeHours || 0));

    const variableTaxable = sumEarnings(taxableEarnings, attendance.workedDays);

    // ── 4. Gratificación sobre la base PACTADA (nunca sobre sí misma)
    const gratificationBaseAmount = contract.gratificationBase === 'sueldo_base'
        ? baseSalaryEarned
        : baseSalaryEarned + overtimeAmount + variableTaxable;
    const gratification = contract.hasGratification
        ? gratificationAmount(gratificationBaseAmount, parameters)
        : 0;

    // ── 5. Imponible y tope
    const totalTaxable = baseSalaryEarned + overtimeAmount + variableTaxable + gratification;
    const cap = taxableCap(parameters.capPensionUf, ufValue);
    const cappedTaxableBase = Math.min(totalTaxable, cap);
    if (totalTaxable > cap && Number.isFinite(cap))
        warnings.push('La renta supera el tope imponible: AFP y salud se calcularon sobre el tope.');

    // ── 6. Cotizaciones
    const pensionAmount = afp ? round(cappedTaxableBase * (parameters.pensionRate / 100)) : 0;
    const pensionCommission = afp ? round(cappedTaxableBase * (afp.commissionRate / 100)) : 0;

    const health = healthContribution(
        cappedTaxableBase, parameters, contract.healthSystem, contract.healthPlanUf, ufValue,
    );
    const afc = unemploymentContribution(totalTaxable, parameters, contract.contractType, ufValue);

    const totalLegalDeductions =
        pensionAmount + pensionCommission + health.total + afc.worker;

    // ── 7. Impuesto único sobre la renta tributable
    const taxableIncomeForTax = Math.max(0, totalTaxable - totalLegalDeductions);
    const tax = incomeTax(taxableIncomeForTax, parameters.incomeTaxBrackets, utmValue);

    // ── 8. No imponibles (la asignación familiar es un HABER)
    const allowance = familyAllowance(totalTaxable, contract.familyCharges, parameters.familyAllowanceBrackets);
    const variableNonTaxable = sumEarnings(nonTaxableEarnings, attendance.workedDays);
    const totalNonTaxable = allowance + variableNonTaxable;

    // ── 9. Líquido
    const totalEarnings = totalTaxable + totalNonTaxable;
    const otherDeductionsTotal = otherDeductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const advancesAmount = Math.max(0, Number(advances) || 0);
    const totalDeductions = totalLegalDeductions + tax + advancesAmount + otherDeductionsTotal;
    const netPay = totalEarnings - totalDeductions;

    if (netPay < 0) warnings.push('El líquido resultó negativo: revisa anticipos y otros descuentos.');

    // Costo empresa: insumo del reemplazo de la estimación del ledger en F4.
    // Nada de esto se le descuenta al trabajador (no aparece en su liquidación),
    // pero es plata que sale de la empresa y por eso alimenta el margen por
    // contrato y la desviación de presupuesto de personal.
    //
    // Dos cotizaciones distintas que se suman hasta jul-2026, y desde ago-2026
    // una sola: la reforma previsional (Ley 21.735) subió el aporte del empleador
    // de 1% a 3,5% ABSORBIENDO al SIS —el patronal es 3,5%, no 3,5% + 1,62%—, y
    // seguirá subiendo hasta 8,5% en 2033. Por eso vienen de la paramétrica
    // versionada y no de una constante.
    //
    // Respaldo al SIS del catálogo de AFP solo para paramétricas anteriores a
    // ADR-011: sin él, una versión vieja dejaría el costo empresa en 0 —y un cero
    // silencioso en el ledger es justo el error que no queremos.
    const paramSisRate = Number(parameters.employerSisRate) || 0;
    const paramPensionRate = Number(parameters.employerPensionRate) || 0;
    const sinParametrica = paramSisRate <= 0 && paramPensionRate <= 0;
    const sisRate = sinParametrica ? (Number(afp?.sisRate) || 0) : paramSisRate;

    const employerSis = round(cappedTaxableBase * (sisRate / 100));
    const employerPension = round(cappedTaxableBase * (paramPensionRate / 100));
    const employerCost = totalEarnings + employerSis + employerPension + afc.employer;

    return {
        baseSalaryEarned,
        overtimeAmount,
        overtimeHourValue: round(hourValue),
        gratification,
        // Se devuelven con el monto EFECTIVO del período (ya prorrateado), que es
        // lo que la liquidación imprime y lo que la línea de planilla guarda.
        taxableEarnings: taxableEarnings.map((e) => ({
            name: e.name, amount: earningAmount(e, attendance.workedDays),
        })),
        totalTaxable,
        familyAllowance: allowance,
        nonTaxableEarnings: nonTaxableEarnings.map((e) => ({
            name: e.name, amount: earningAmount(e, attendance.workedDays),
        })),
        totalNonTaxable,
        totalEarnings,
        cappedTaxableBase: round(cappedTaxableBase),
        pensionAmount,
        pensionCommission,
        healthAmount: health.legal,
        healthAdditional: health.additional,
        unemploymentAmount: afc.worker,
        totalLegalDeductions,
        taxableIncomeForTax,
        incomeTax: tax,
        advances: advancesAmount,
        otherDeductions,
        totalDeductions,
        netPay,
        employerSis,
        employerPension,
        employerUnemployment: afc.employer,
        employerCost,
        warnings,
    };
}
