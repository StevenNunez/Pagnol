import { describe, it, expect } from 'vitest';
import {
    calculatePayroll, earnedBaseSalary, overtimeHourValue, gratificationAmount,
    taxableCap, healthContribution, unemploymentContribution, familyAllowance, incomeTax,
    earningAmount, sumEarnings,
    OVERTIME_WEEK_DAYS, OVERTIME_MONTH_DAYS, OVERTIME_SURCHARGE,
} from './payrollMath';
import type { EmploymentContract, PayrollParameters, AfpRate } from '@/modules/core/lib/data';

// Parámetros de la semilla F1. ⚠️ Son VALORES DE REFERENCIA sin verificar contra
// normativa: estos tests fijan la MECÁNICA del motor, no dan por buenos los
// números legales. Cuando se verifiquen las tasas, los esperados cambian y estos
// tests deben seguir pasando con la nueva paramétrica.
const PARAMS: PayrollParameters = {
    id: 'p1',
    effectiveFrom: '2026-01-01',
    minimumWage: 529000,
    capPensionUf: 87.8,
    capUnemploymentUf: 131.9,
    pensionRate: 10,
    healthRate: 7,
    afcIndefiniteWorker: 0.6,
    afcIndefiniteEmployer: 2.4,
    afcFixedEmployer: 3.0,
    gratificationRate: 25,
    gratificationCapImm: 4.75,
    familyAllowanceBrackets: [
        { max_income: 620251, amount: 22007 },
        { max_income: 905941, amount: 13505 },
        { max_income: 1412957, amount: 4267 },
        { max_income: null, amount: 0 },
    ],
    incomeTaxBrackets: [
        { from_utm: 0, to_utm: 13.5, factor: 0, deduction_utm: 0 },
        { from_utm: 13.5, to_utm: 30, factor: 0.04, deduction_utm: 0.54 },
        { from_utm: 30, to_utm: 50, factor: 0.08, deduction_utm: 1.74 },
        { from_utm: 50, to_utm: 70, factor: 0.135, deduction_utm: 4.49 },
        { from_utm: 70, to_utm: 90, factor: 0.23, deduction_utm: 11.14 },
        { from_utm: 90, to_utm: 120, factor: 0.304, deduction_utm: 17.8 },
        { from_utm: 120, to_utm: 310, factor: 0.35, deduction_utm: 23.32 },
        { from_utm: 310, to_utm: null, factor: 0.4, deduction_utm: 38.82 },
    ],
    notes: 'Semilla inicial F1',
};

const UF = 40844.79;
const UTM = 71649;

const AFP_MODELO: AfpRate = {
    id: 'a1', name: 'Modelo', commissionRate: 0.58, sisRate: 1.53,
    effectiveFrom: '2026-01-01', isActive: true,
};

function contract(over: Partial<EmploymentContract> = {}): EmploymentContract {
    return {
        id: 'c1', tenantId: 't1', userId: 'u1',
        effectiveFrom: '2026-01-01',
        contractType: 'indefinido',
        contractEndDate: null,
        salaryMode: 'monthly',
        baseSalary: 1000000,
        workSchedule: '5x2',
        weeklyHours: 44,
        afpName: 'Modelo',
        healthSystem: 'fonasa',
        healthPlanUf: null,
        familyCharges: 0,
        hasGratification: true,
        gratificationBase: 'imponible',
        notes: null,
        createdBy: null, createdByName: null, createdAt: '2026-01-01',
        ...over,
    };
}

const base = (over: Partial<Parameters<typeof calculatePayroll>[0]> = {}) => calculatePayroll({
    contract: contract(),
    attendance: { workedDays: 30, overtimeHours: 0 },
    parameters: PARAMS,
    afp: AFP_MODELO,
    ufValue: UF,
    utmValue: UTM,
    ...over,
});

describe('earnedBaseSalary — proporcionalidad por ausencias', () => {
    it('mes completo paga el sueldo íntegro', () => {
        expect(earnedBaseSalary(1000000, 'monthly', 30)).toBe(1000000);
    });

    it('descuenta los días no trabajados (el bug que la calculadora no tenía)', () => {
        // 3 días de ausencia sobre 30: paga 27/30
        expect(earnedBaseSalary(1000000, 'monthly', 27)).toBe(900000);
    });

    it('un mes de 31 días no paga de más: el divisor 30 es tope', () => {
        expect(earnedBaseSalary(1000000, 'monthly', 31)).toBe(1000000);
    });

    it('modalidad diaria multiplica el valor día, no lo proporcionaliza', () => {
        expect(earnedBaseSalary(45000, 'daily', 20)).toBe(900000);
    });

    it('sin días trabajados no devenga', () => {
        expect(earnedBaseSalary(1000000, 'monthly', 0)).toBe(0);
    });

    it('sueldo inválido no inventa un monto', () => {
        expect(earnedBaseSalary(0, 'monthly', 30)).toBe(0);
        expect(earnedBaseSalary(NaN, 'monthly', 30)).toBe(0);
    });
});

describe('overtimeHourValue — jornada real, no 180 hardcodeado', () => {
    it('reproduce el valor de la liquidación real: $7.159,05 con 900.000 y 44 h', () => {
        expect(overtimeHourValue(900000, 44)).toBeCloseTo(7159.05, 2);
    });

    it('usa la jornada del contrato', () => {
        const v44 = overtimeHourValue(1000000, 44);
        const factor = (OVERTIME_WEEK_DAYS / (OVERTIME_MONTH_DAYS * 44)) * OVERTIME_SURCHARGE;
        expect(v44).toBeCloseTo(1000000 * Math.round(factor * 1e7) / 1e7, 6);
    });

    it('una jornada menor encarece la hora (mismo sueldo, menos horas)', () => {
        expect(overtimeHourValue(1000000, 40)).toBeGreaterThan(overtimeHourValue(1000000, 44));
    });

    it('en modalidad diaria deriva del equivalente mensual', () => {
        // Sin esto, un valor-día daría una hora extra ~30 veces menor
        expect(overtimeHourValue(45000, 44, 'daily')).toBeCloseTo(overtimeHourValue(45000 * 30, 44), 6);
    });

    it('jornada inválida no divide por cero', () => {
        expect(overtimeHourValue(1000000, 0)).toBe(0);
    });
});

describe('gratificationAmount — art. 50 con tope', () => {
    it('aplica el 25% cuando está bajo el tope', () => {
        expect(gratificationAmount(600000, PARAMS)).toBe(150000);
    });

    it('corta en el tope (4,75 IMM / 12)', () => {
        const tope = Math.round((4.75 * 529000) / 12);
        expect(gratificationAmount(50000000, PARAMS)).toBe(tope);
    });

    it('el tope sale del IMM vigente, no de una constante del componente', () => {
        const conImmViejo = gratificationAmount(50000000, { ...PARAMS, minimumWage: 460000 });
        const conImmNuevo = gratificationAmount(50000000, PARAMS);
        // El componente usaba 460000: subestimaba el tope en cada liquidación
        expect(conImmNuevo).toBeGreaterThan(conImmViejo);
    });

    it('base cero no genera gratificación', () => {
        expect(gratificationAmount(0, PARAMS)).toBe(0);
    });
});

describe('gratificación: la base pactada por contrato (ADR-008)', () => {
    const attendance = { workedDays: 30, overtimeHours: 10 };

    it("base 'imponible' incluye horas extra y bonos", () => {
        const r = base({
            contract: contract({ gratificationBase: 'imponible' }),
            attendance,
            taxableEarnings: [{ name: 'Bono', amount: 100000 }],
        });
        const esperado = gratificationAmount(
            r.baseSalaryEarned + r.overtimeAmount + 100000, PARAMS,
        );
        expect(r.gratification).toBe(esperado);
    });

    it("base 'sueldo_base' ignora extras y bonos", () => {
        const r = base({
            contract: contract({ gratificationBase: 'sueldo_base' }),
            attendance,
            taxableEarnings: [{ name: 'Bono', amount: 100000 }],
        });
        expect(r.gratification).toBe(gratificationAmount(r.baseSalaryEarned, PARAMS));
    });

    it("'imponible' paga más que 'sueldo_base' cuando hay extras y no se topa", () => {
        // Sueldo bajo el umbral del tope: si no, ambas bases dan el mismo máximo
        // y la diferencia entre ellas es invisible (ver el test siguiente).
        const bajo = { baseSalary: 500000 };
        const imp = base({ contract: contract({ ...bajo, gratificationBase: 'imponible' }), attendance });
        const sb = base({ contract: contract({ ...bajo, gratificationBase: 'sueldo_base' }), attendance });
        expect(imp.gratification).toBeGreaterThan(sb.gratification);
    });

    it('para sueldos altos la base pactada da igual: manda el tope', () => {
        // Consecuencia práctica de la decisión 1 del ADR-008 que conviene tener
        // explícita: elegir la base solo cambia plata mientras el 25% no tope.
        const alto = { baseSalary: 3000000 };
        const imp = base({ contract: contract({ ...alto, gratificationBase: 'imponible' }), attendance });
        const sb = base({ contract: contract({ ...alto, gratificationBase: 'sueldo_base' }), attendance });
        const tope = Math.round((4.75 * 529000) / 12);
        expect(imp.gratification).toBe(tope);
        expect(sb.gratification).toBe(tope);
    });

    it('la gratificación NUNCA entra en su propia base (no es circular)', () => {
        const r = base({ contract: contract({ gratificationBase: 'imponible' }) });
        // Si se incluyera a sí misma, sería 25% de (sueldo + grat) > 25% del sueldo
        expect(r.gratification).toBe(gratificationAmount(r.baseSalaryEarned, PARAMS));
        expect(r.totalTaxable).toBe(r.baseSalaryEarned + r.gratification);
    });

    it('un contrato sin gratificación pactada no la devenga', () => {
        const r = base({ contract: contract({ hasGratification: false }) });
        expect(r.gratification).toBe(0);
    });
});

describe('taxableCap — tope imponible en UF', () => {
    it('convierte el tope de UF a pesos', () => {
        expect(taxableCap(87.8, UF)).toBeCloseTo(87.8 * UF, 6);
    });

    it('sin UF válida no topa (y el motor lo avisa)', () => {
        expect(taxableCap(87.8, 0)).toBe(Infinity);
    });

    it('AFP y salud se calculan sobre el tope, no sobre la renta completa', () => {
        const sueldoAlto = 10000000;
        const r = base({ contract: contract({ baseSalary: sueldoAlto, hasGratification: false }) });
        const tope = 87.8 * UF;
        expect(r.cappedTaxableBase).toBe(Math.round(tope));
        expect(r.pensionAmount).toBe(Math.round(tope * 0.10));
        expect(r.warnings.some(w => /tope imponible/i.test(w))).toBe(true);
    });
});

describe('healthContribution — el 7% es piso, no techo', () => {
    it('Fonasa cotiza exactamente el porcentaje legal', () => {
        const h = healthContribution(1000000, PARAMS, 'fonasa', null, UF);
        expect(h.total).toBe(70000);
        expect(h.additional).toBe(0);
    });

    it('Isapre con plan más caro cobra el plan, y la diferencia es "adicional"', () => {
        const planUf = 3;
        const h = healthContribution(1000000, PARAMS, 'isapre', planUf, UF);
        const plan = Math.round(planUf * UF);
        expect(h.total).toBe(plan);
        expect(h.legal).toBe(70000);
        expect(h.additional).toBe(plan - 70000);
    });

    it('Isapre con plan más barato que el 7% cotiza el piso legal', () => {
        const h = healthContribution(1000000, PARAMS, 'isapre', 1, UF);
        expect(h.total).toBe(70000);
        expect(h.additional).toBe(0);
    });

    it('Isapre sin plan no rompe: cotiza el piso y el motor avisa', () => {
        const r = base({ contract: contract({ healthSystem: 'isapre', healthPlanUf: null }) });
        expect(r.healthAdditional).toBe(0);
        expect(r.warnings.some(w => /Isapre sin plan/i.test(w))).toBe(true);
    });
});

describe('unemploymentContribution — AFC según tipo de contrato', () => {
    it('indefinido: aporta el trabajador y el empleador', () => {
        const a = unemploymentContribution(1000000, PARAMS, 'indefinido', UF);
        expect(a.worker).toBe(6000);
        expect(a.employer).toBe(24000);
    });

    it('plazo fijo: el trabajador NO aporta (la calculadora anterior le descontaba)', () => {
        const a = unemploymentContribution(1000000, PARAMS, 'plazo_fijo', UF);
        expect(a.worker).toBe(0);
        expect(a.employer).toBe(30000);
    });

    it('por obra: mismo trato que plazo fijo', () => {
        expect(unemploymentContribution(1000000, PARAMS, 'por_obra', UF).worker).toBe(0);
    });

    it('usa su tope propio, distinto al de AFP/salud', () => {
        const enorme = 999999999;
        const a = unemploymentContribution(enorme, PARAMS, 'indefinido', UF);
        expect(a.worker).toBe(Math.round(131.9 * UF * 0.006));
        // y ese tope es más alto que el de AFP
        expect(131.9 * UF).toBeGreaterThan(87.8 * UF);
    });
});

describe('familyAllowance — haber no imponible por carga', () => {
    it('paga el monto del tramo por cada carga', () => {
        expect(familyAllowance(500000, 2, PARAMS.familyAllowanceBrackets)).toBe(22007 * 2);
    });

    it('cae de tramo cuando sube la renta', () => {
        expect(familyAllowance(700000, 1, PARAMS.familyAllowanceBrackets)).toBe(13505);
        expect(familyAllowance(1000000, 1, PARAMS.familyAllowanceBrackets)).toBe(4267);
    });

    it('sobre el último tramo no hay derecho', () => {
        expect(familyAllowance(5000000, 3, PARAMS.familyAllowanceBrackets)).toBe(0);
    });

    it('sin cargas no paga', () => {
        expect(familyAllowance(500000, 0, PARAMS.familyAllowanceBrackets)).toBe(0);
    });

    it('el borde del tramo es inclusivo', () => {
        expect(familyAllowance(620251, 1, PARAMS.familyAllowanceBrackets)).toBe(22007);
        expect(familyAllowance(620252, 1, PARAMS.familyAllowanceBrackets)).toBe(13505);
    });

    it('no confía en el orden de la jsonb', () => {
        const desordenado = [...PARAMS.familyAllowanceBrackets].reverse();
        expect(familyAllowance(500000, 1, desordenado)).toBe(22007);
    });

    it('entra como HABER, no como descuento', () => {
        const r = base({ contract: contract({ baseSalary: 500000, familyCharges: 2, hasGratification: false }) });
        expect(r.familyAllowance).toBeGreaterThan(0);
        expect(r.totalNonTaxable).toBe(r.familyAllowance);
        expect(r.totalEarnings).toBe(r.totalTaxable + r.familyAllowance);
    });
});

describe('incomeTax — impuesto único de 2ª categoría', () => {
    it('el primer tramo es exento', () => {
        expect(incomeTax(13 * UTM, PARAMS.incomeTaxBrackets, UTM)).toBe(0);
    });

    it('aplica factor menos rebaja en el tramo que corresponde', () => {
        const renta = 20 * UTM; // tramo 13,5–30
        const esperado = Math.round(renta * 0.04 - 0.54 * UTM);
        expect(incomeTax(renta, PARAMS.incomeTaxBrackets, UTM)).toBe(esperado);
    });

    it('el impuesto crece con la renta (monotonía entre tramos)', () => {
        const a = incomeTax(20 * UTM, PARAMS.incomeTaxBrackets, UTM);
        const b = incomeTax(40 * UTM, PARAMS.incomeTaxBrackets, UTM);
        const c = incomeTax(100 * UTM, PARAMS.incomeTaxBrackets, UTM);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });

    it('el último tramo no tiene techo', () => {
        expect(incomeTax(500 * UTM, PARAMS.incomeTaxBrackets, UTM)).toBeGreaterThan(0);
    });

    it('nunca devuelve impuesto negativo', () => {
        expect(incomeTax(13.6 * UTM, PARAMS.incomeTaxBrackets, UTM)).toBeGreaterThanOrEqual(0);
    });

    it('sin UTM no calcula (y el motor lo avisa)', () => {
        expect(incomeTax(5000000, PARAMS.incomeTaxBrackets, 0)).toBe(0);
    });

    it('se calcula sobre la renta MENOS cotizaciones, no sobre el imponible bruto', () => {
        const r = base({ contract: contract({ baseSalary: 3000000 }) });
        expect(r.taxableIncomeForTax).toBe(r.totalTaxable - r.totalLegalDeductions);
        expect(r.taxableIncomeForTax).toBeLessThan(r.totalTaxable);
    });
});

describe('calculatePayroll — la liquidación completa', () => {
    it('cuadra: líquido = haberes − descuentos', () => {
        const r = base({
            attendance: { workedDays: 30, overtimeHours: 5 },
            taxableEarnings: [{ name: 'Bono producción', amount: 150000 }],
            nonTaxableEarnings: [{ name: 'Colación', amount: 60000 }, { name: 'Movilización', amount: 40000 }],
            advances: 200000,
        });
        expect(r.netPay).toBe(r.totalEarnings - r.totalDeductions);
        expect(r.totalEarnings).toBe(r.totalTaxable + r.totalNonTaxable);
        expect(r.totalDeductions).toBe(
            r.totalLegalDeductions + r.incomeTax + r.advances
        );
    });

    it('el imponible es la suma de sus partes', () => {
        const r = base({
            attendance: { workedDays: 25, overtimeHours: 8 },
            taxableEarnings: [{ name: 'Bono', amount: 90000 }],
        });
        expect(r.totalTaxable).toBe(
            r.baseSalaryEarned + r.overtimeAmount + 90000 + r.gratification
        );
    });

    it('los no imponibles no pagan cotizaciones', () => {
        const sin = base({});
        const con = base({ nonTaxableEarnings: [{ name: 'Colación', amount: 200000 }] });
        expect(con.pensionAmount).toBe(sin.pensionAmount);
        expect(con.healthAmount).toBe(sin.healthAmount);
        expect(con.totalEarnings).toBe(sin.totalEarnings + 200000);
    });

    it('las ausencias bajan el líquido (regresión del bug de la calculadora)', () => {
        const completo = base({ attendance: { workedDays: 30, overtimeHours: 0 } });
        const conFaltas = base({ attendance: { workedDays: 27, overtimeHours: 0 } });
        expect(conFaltas.baseSalaryEarned).toBeLessThan(completo.baseSalaryEarned);
        expect(conFaltas.netPay).toBeLessThan(completo.netPay);
    });

    it('separa el 10% previsional de la comisión de la AFP', () => {
        const r = base({ contract: contract({ hasGratification: false }) });
        expect(r.pensionAmount).toBe(Math.round(r.cappedTaxableBase * 0.10));
        expect(r.pensionCommission).toBe(Math.round(r.cappedTaxableBase * 0.58 / 100));
        expect(r.pensionCommission).toBeLessThan(r.pensionAmount);
    });

    it('el SIS lo paga el empleador: no aparece en los descuentos', () => {
        const r = base({ contract: contract({ hasGratification: false }) });
        expect(r.employerSis).toBe(Math.round(r.cappedTaxableBase * 0.0153));
        expect(r.totalDeductions).not.toContain(r.employerSis);
        expect(r.employerCost).toBe(r.totalEarnings + r.employerSis + r.employerUnemployment);
    });

    it('sin AFP no descuenta previsional pero avisa', () => {
        const r = base({ afp: null });
        expect(r.pensionAmount).toBe(0);
        expect(r.pensionCommission).toBe(0);
        expect(r.warnings.some(w => /AFP/i.test(w))).toBe(true);
    });

    it('sin días trabajados el líquido no es negativo por sí solo', () => {
        const r = base({ attendance: { workedDays: 0, overtimeHours: 0 } });
        expect(r.baseSalaryEarned).toBe(0);
        expect(r.netPay).toBeGreaterThanOrEqual(0);
        expect(r.warnings.some(w => /días trabajados/i.test(w))).toBe(true);
    });

    it('avisa cuando los anticipos dejan el líquido negativo', () => {
        const r = base({ advances: 99999999 });
        expect(r.netPay).toBeLessThan(0);
        expect(r.warnings.some(w => /negativo/i.test(w))).toBe(true);
    });

    it('modalidad diaria: liquida por días efectivos', () => {
        const r = base({
            contract: contract({ salaryMode: 'daily', baseSalary: 45000, hasGratification: false }),
            attendance: { workedDays: 20, overtimeHours: 0 },
        });
        expect(r.baseSalaryEarned).toBe(900000);
    });

    it('un plazo fijo tiene mayor líquido que un indefinido idéntico (no aporta AFC)', () => {
        const indef = base({ contract: contract({ contractType: 'indefinido' }) });
        const plazo = base({ contract: contract({ contractType: 'plazo_fijo', contractEndDate: '2026-12-31' }) });
        expect(plazo.unemploymentAmount).toBe(0);
        expect(plazo.netPay).toBeGreaterThan(indef.netPay);
    });

    it('el mismo input da el mismo resultado (puro, sin fechas implícitas)', () => {
        const a = base({ attendance: { workedDays: 22, overtimeHours: 3 } });
        const b = base({ attendance: { workedDays: 22, overtimeHours: 3 } });
        expect(a).toEqual(b);
    });
});

// =============================================================================
// ANCLAJE CONTRA LIQUIDACIONES REALES
//
// Dos liquidaciones consecutivas del mismo trabajador (feb y mar 2026), emitidas
// por un tercero, con el finiquito del mismo legajo. Valen como par porque
// febrero es un mes COMPLETO con gratificación TOPADA y anticipo, y marzo es un
// mes PARCIAL (16 días) con gratificación SIN topar: entre las dos ejercitan la
// proporcionalidad, el tope y el impuesto en dos tramos distintos.
//
// Perfil: sueldo base 900.000 mensual · jornada 44 h · AFP ProVida · Fonasa ·
// 0 cargas · contrato POR OBRA (finiquito por art. 159 N°5) ⇒ el trabajador no
// aporta seguro de cesantía. Datos personales omitidos a propósito.
//
// Estos tests NO son de mecánica: si fallan, el motor dejó de reproducir un
// documento real. No los ajustes al resultado nuevo sin entender por qué cambió.
// =============================================================================

// UTM derivada del propio documento: la rebaja del tramo (0,54 UTM) aparece como
// $37.553, ⇒ UTM ≈ 69.542. Se usa ese valor para reproducir el impuesto exacto.
const UTM_FEB_2026 = 69542;
const UF_FEB_2026 = 39000; // aproximada: ningún tope se activa a este nivel de renta

const CONTRATO_REAL = contract({
    baseSalary: 900000,
    salaryMode: 'monthly',
    contractType: 'por_obra',
    contractEndDate: '2026-03-16',
    weeklyHours: 44,
    afpName: 'ProVida',
    healthSystem: 'fonasa',
    healthPlanUf: null,
    familyCharges: 0,
    hasGratification: true,
    gratificationBase: 'imponible',
});

const AFP_PROVIDA: AfpRate = {
    id: 'a2', name: 'ProVida', commissionRate: 1.45, sisRate: 1.53,
    effectiveFrom: '2026-01-01', isActive: true,
};

describe('anclaje — liquidación real de febrero 2026 (mes completo, gratificación topada)', () => {
    const r = calculatePayroll({
        contract: CONTRATO_REAL,
        attendance: { workedDays: 30, overtimeHours: 40 },
        parameters: PARAMS,
        afp: AFP_PROVIDA,
        ufValue: UF_FEB_2026,
        utmValue: UTM_FEB_2026,
        nonTaxableEarnings: [
            { name: 'Movilización', amount: 69920 },
            { name: 'Asignación desgaste herramientas', amount: 143181 },
            { name: 'Colación', amount: 25368 },
        ],
        advances: 300000,
    });

    it('sueldo base: mes completo, sin proporcionalizar', () => {
        expect(r.baseSalaryEarned).toBe(900000);
    });

    it('horas extra: 40 h = $286.362', () => {
        expect(r.overtimeAmount).toBe(286362);
    });

    it('gratificación legal TOPADA = $209.396 (4,75 IMM / 12 con IMM 529.000)', () => {
        // Confirma que el IMM de la semilla F1 es el correcto: con 460.000 (la
        // constante del componente viejo) habría dado $182.083.
        expect(r.gratification).toBe(209396);
    });

    it('total imponible = $1.395.758', () => {
        expect(r.totalTaxable).toBe(1395758);
    });

    it('AFP ProVida 11,45% (10% + 1,45% comisión) = $159.814', () => {
        expect(r.pensionAmount + r.pensionCommission).toBe(159814);
    });

    it('Fonasa 7% = $97.703', () => {
        expect(r.healthAmount).toBe(97703);
        expect(r.healthAdditional).toBe(0);
    });

    it('seguro de cesantía = 0 (contrato por obra)', () => {
        expect(r.unemploymentAmount).toBe(0);
    });

    it('base tributable = imponible − cotizaciones = $1.138.241', () => {
        expect(r.taxableIncomeForTax).toBe(1138241);
    });

    it('impuesto único = $7.977 (tramo 0,04 con rebaja 0,54 UTM)', () => {
        expect(r.incomeTax).toBe(7977);
    });

    it('total haberes = $1.634.227', () => {
        expect(r.totalEarnings).toBe(1634227);
    });

    it('total descuentos = $565.494 (incluye anticipo de $300.000)', () => {
        expect(r.totalDeductions).toBe(565494);
    });

    it('LÍQUIDO A PAGAR = $1.068.733', () => {
        expect(r.netPay).toBe(1068733);
    });
});

describe('prorrateo de haberes por días trabajados (ADR-009 §2)', () => {
    it('reproduce el prorrateo real: $69.920 mensuales con 16 días = $37.291', () => {
        expect(earningAmount({ name: 'Movilización', amount: 69920, prorate: true }, 16)).toBe(37291);
    });

    it('y la colación: $25.368 con 16 días = $13.530', () => {
        expect(earningAmount({ name: 'Colación', amount: 25368, prorate: true }, 16)).toBe(13530);
    });

    it('un mes completo devuelve el monto mensual intacto', () => {
        expect(earningAmount({ name: 'Movilización', amount: 69920, prorate: true }, 30)).toBe(69920);
    });

    it('sin el flag NO prorratea (el desgaste de herramientas de la liquidación real)', () => {
        expect(earningAmount({ name: 'Desgaste herramientas', amount: 143181 }, 16)).toBe(143181);
    });

    it('un mes de 31 días no infla el haber', () => {
        expect(earningAmount({ name: 'Colación', amount: 25368, prorate: true }, 31)).toBe(25368);
    });

    it('sin días trabajados no hay haber prorrateado', () => {
        expect(earningAmount({ name: 'Colación', amount: 25368, prorate: true }, 0)).toBe(0);
    });

    it('el motor devuelve el monto EFECTIVO, no el mensual', () => {
        const r = base({
            attendance: { workedDays: 16, overtimeHours: 0 },
            nonTaxableEarnings: [{ name: 'Movilización', amount: 69920, prorate: true }],
        });
        expect(r.nonTaxableEarnings[0].amount).toBe(37291);
        expect(r.totalNonTaxable).toBe(37291);
    });

    it('un haber imponible prorrateado sí entra a la base de cotizaciones', () => {
        const r = base({
            contract: contract({ hasGratification: false }),
            attendance: { workedDays: 15, overtimeHours: 0 },
            taxableEarnings: [{ name: 'Bono mensual', amount: 100000, prorate: true }],
        });
        expect(r.taxableEarnings[0].amount).toBe(50000);
        expect(r.totalTaxable).toBe(r.baseSalaryEarned + 50000);
    });
});

describe('anclaje — liquidación real de enero 2026 (mes completo, 27 h extra)', () => {
    // UTM derivada del documento: rebaja del tramo 0,54 UTM = $37.666 ⇒ ~69.752.
    const r = calculatePayroll({
        contract: CONTRATO_REAL,
        attendance: { workedDays: 30, overtimeHours: 27 },
        parameters: PARAMS,
        afp: AFP_PROVIDA,
        ufValue: UF_FEB_2026,
        utmValue: 69752,
        nonTaxableEarnings: [
            { name: 'Movilización', amount: 69920 },
            { name: 'Colación', amount: 25368 },
        ],
        advances: 300000,
    });

    it('horas extra: 27 h = $193.294 (mismo factor que feb y mar)', () => {
        expect(r.overtimeAmount).toBe(193294);
    });

    it('total imponible = $1.302.690', () => {
        expect(r.totalTaxable).toBe(1302690);
    });

    it('AFP = $149.158 · Fonasa = $91.188', () => {
        expect(r.pensionAmount + r.pensionCommission).toBe(149158);
        expect(r.healthAmount).toBe(91188);
    });

    it('base tributable = $1.062.344 → impuesto $4.828', () => {
        expect(r.taxableIncomeForTax).toBe(1062344);
        expect(r.incomeTax).toBe(4828);
    });

    it('total haberes = $1.397.978 · descuentos = $545.174', () => {
        expect(r.totalEarnings).toBe(1397978);
        expect(r.totalDeductions).toBe(545174);
    });

    it('LÍQUIDO A PAGAR = $852.804', () => {
        expect(r.netPay).toBe(852804);
    });
});

describe('anclaje — liquidación real de marzo 2026 (16 días, gratificación sin topar)', () => {
    const r = calculatePayroll({
        contract: CONTRATO_REAL,
        attendance: { workedDays: 16, overtimeHours: 31 },
        parameters: PARAMS,
        afp: AFP_PROVIDA,
        ufValue: UF_FEB_2026,
        utmValue: UTM_FEB_2026,
        nonTaxableEarnings: [
            { name: 'Movilización', amount: 37291 },
            { name: 'Vacaciones proporcionales', amount: 320000 },
            { name: 'Colación', amount: 13530 },
        ],
    });

    it('sueldo base proporcional: 900.000 / 30 × 16 = $480.000', () => {
        // El caso que la calculadora vieja no hacía: pagaba el mes entero.
        expect(r.baseSalaryEarned).toBe(480000);
    });

    it('la hora extra no se proporcionaliza: sigue valiendo lo mismo que en febrero', () => {
        expect(r.overtimeAmount).toBe(221931);
        expect(r.overtimeHourValue).toBe(7159);
    });

    it('gratificación SIN topar = $175.483 (25% de 480.000 + 221.931)', () => {
        // Prueba que la base es el imponible del mes y que NO se incluye a sí
        // misma: 25% de 701.931 = 175.483.
        expect(r.gratification).toBe(175483);
    });

    it('total imponible = $877.414', () => {
        expect(r.totalTaxable).toBe(877414);
    });

    it('AFP ProVida = $100.464 y Fonasa = $61.419', () => {
        expect(r.pensionAmount + r.pensionCommission).toBe(100464);
        expect(r.healthAmount).toBe(61419);
    });

    it('base tributable = $715.531, exenta de impuesto', () => {
        expect(r.taxableIncomeForTax).toBe(715531);
        expect(r.incomeTax).toBe(0);
    });

    it('las vacaciones proporcionales del finiquito no son imponibles', () => {
        // $320.000 entran al líquido pero no pagan AFP ni salud
        expect(r.totalTaxable).toBe(877414);
        expect(r.totalNonTaxable).toBe(37291 + 320000 + 13530);
    });

    it('LÍQUIDO A PAGAR = $1.086.351 (±1 por redondeos del emisor)', () => {
        expect(Math.abs(r.netPay - 1086351)).toBeLessThanOrEqual(1);
    });
});

// ⚠️ PENDIENTE — el par anterior cubre FONASA. Falta un caso ISAPRE para cerrar
// la condición de salida a producción del RFC-003: es el único camino donde el
// plan en UF puede superar al 7% legal, y ninguna de estas dos liquidaciones lo
// ejercita. Tampoco están validados los topes imponibles en UF (la renta nunca
// se acercó), los tramos altos del impuesto ni la asignación familiar (0 cargas).
describe.todo('anclaje contra liquidación real con Isapre');
