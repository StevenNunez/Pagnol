import { describe, it, expect } from 'vitest';
import {
    calculateSeverance, yearsOfService, monthsOfService, daysBetween,
    cappedSeveranceBase, proportionalVacationDays, vacationCalendarDays,
    isVacationWorkday,
    SEVERANCE_BASE_CAP_UF, SEVERANCE_MAX_YEARS, VACATION_DAYS_PER_MONTH,
} from './severanceMath';
import type { EmploymentContract } from '@/modules/core/lib/data';

// ⚠️ Estos tests fijan la mecánica según NORMATIVA verificada, no contra un
// documento real emitido por un tercero (no había finiquito real disponible).
// Ver el describe.todo del final.

const UF = 40844.79;

/** Festivos legales de Chile 2026 (verificados, ver ADR-012). */
const FERIADOS_2026 = [
    '2026-01-01', '2026-04-03', '2026-04-04', '2026-05-01', '2026-05-21',
    '2026-06-29', '2026-07-16', '2026-08-15', '2026-09-18', '2026-09-19',
    '2026-10-12', '2026-10-31', '2026-11-01', '2026-12-08', '2026-12-25',
];

function contract(over: Partial<EmploymentContract> = {}): EmploymentContract {
    return {
        id: 'c1', tenantId: 't1', userId: 'u1',
        effectiveFrom: '2020-01-01', contractType: 'indefinido', contractEndDate: null,
        salaryMode: 'monthly', baseSalary: 1000000, workSchedule: '5x2', weeklyHours: 42,
        afpName: 'Modelo', healthSystem: 'fonasa', healthPlanUf: null, familyCharges: 0,
        hasGratification: true, gratificationBase: 'imponible',
        notes: null, createdBy: null, createdByName: null, createdAt: '2020-01-01',
        ...over,
    };
}

const base = (over: Partial<Parameters<typeof calculateSeverance>[0]> = {}) => calculateSeverance({
    contract: contract(),
    startDate: '2020-01-01',
    endDate: '2026-07-31',
    cause: 'necesidades_empresa',
    noticeGiven: false,
    lastRemuneration: 1000000,
    ufValue: UF,
    holidays: FERIADOS_2026,
    ...over,
});

describe('antigüedad', () => {
    it('cuenta los días con ambos extremos incluidos', () => {
        expect(daysBetween('2026-07-01', '2026-07-08')).toBe(8);
    });

    it('un año exacto son 12 meses', () => {
        expect(monthsOfService('2025-01-01', '2025-12-31')).toBeCloseTo(12, 1);
    });

    it('🔴 fracción de EXACTAMENTE 6 meses NO suma un año (art. 163 dice "superior")', () => {
        // 3 años y 6 meses justos: la calculadora vieja usaba >= y pagaba 4 años.
        const y = yearsOfService('2023-01-01', '2026-06-30');
        expect(y).toBe(3);
    });

    it('fracción superior a 6 meses SÍ suma un año', () => {
        expect(yearsOfService('2023-01-01', '2026-08-15')).toBe(4);
    });

    it('menos de un año da 0 años de servicio', () => {
        expect(yearsOfService('2026-01-01', '2026-06-30')).toBe(0);
    });

    it('la indemnización se topa en 11 años aunque la antigüedad sea mayor', () => {
        const r = base({ startDate: '2005-01-01' });
        expect(r.yearsOfService).toBeGreaterThan(SEVERANCE_MAX_YEARS);
        expect(r.indemnifiableYears).toBe(SEVERANCE_MAX_YEARS);
        expect(r.warnings.some((w) => w.includes('se topa en 11'))).toBe(true);
    });
});

describe('tope de 90 UF en la base (art. 172)', () => {
    it('una remuneración bajo el tope no se toca', () => {
        expect(cappedSeveranceBase(1000000, UF)).toBe(1000000);
    });

    it('🔴 sobre 90 UF se topa — no existía en la calculadora vieja', () => {
        const alta = 5000000;
        const tope = SEVERANCE_BASE_CAP_UF * UF;
        expect(alta).toBeGreaterThan(tope);
        expect(cappedSeveranceBase(alta, UF)).toBe(tope);
    });

    it('la indemnización usa la base topada y avisa', () => {
        const r = base({ lastRemuneration: 5000000, startDate: '2023-01-01' });
        expect(r.cappedBase).toBe(Math.round(SEVERANCE_BASE_CAP_UF * UF));
        expect(r.uncappedBase).toBe(5000000);
        expect(r.indemnityYears).toBe(Math.round(r.cappedBase * r.indemnifiableYears));
        expect(r.warnings.some((w) => w.includes('90 UF'))).toBe(true);
    });

    it('🔴 el feriado proporcional NO se topa: se paga con la remuneración real', () => {
        // El art. 172 solo limita las indemnizaciones legales. Toparlo acá sería
        // quitarle plata al trabajador.
        const r = base({ lastRemuneration: 5000000, startDate: '2023-01-01' });
        const esperado = Math.round((5000000 / 30) * r.vacationDaysCorridos);
        expect(r.vacationPay).toBe(esperado);
        expect(r.vacationPay).toBeGreaterThan(Math.round((r.cappedBase / 30) * r.vacationDaysCorridos));
    });

    it('sin UF no se topa, pero se avisa', () => {
        const r = base({ ufValue: 0, lastRemuneration: 5000000 });
        expect(r.cappedBase).toBe(5000000);
        expect(r.warnings.some((w) => w.includes('Sin valor de UF'))).toBe(true);
    });
});

describe('causales', () => {
    it('necesidades de la empresa paga años de servicio y aviso previo', () => {
        const r = base({ cause: 'necesidades_empresa', noticeGiven: false });
        expect(r.indemnityYears).toBeGreaterThan(0);
        expect(r.indemnityNotice).toBe(r.cappedBase);
    });

    it('con aviso dado NO se paga la sustitutiva', () => {
        const r = base({ cause: 'necesidades_empresa', noticeGiven: true });
        expect(r.indemnityYears).toBeGreaterThan(0);
        expect(r.indemnityNotice).toBe(0);
    });

    it('renuncia no paga indemnización, pero sí feriado proporcional', () => {
        const r = base({ cause: 'renuncia' });
        expect(r.indemnityYears).toBe(0);
        expect(r.indemnityNotice).toBe(0);
        expect(r.vacationPay).toBeGreaterThan(0);
    });

    it('despido disciplinario (art. 160) no paga indemnización', () => {
        const r = base({ cause: 'despido_disciplinario' });
        expect(r.indemnityYears).toBe(0);
        expect(r.indemnityNotice).toBe(0);
    });

    it('vencimiento del plazo y conclusión de la obra no pagan años de servicio', () => {
        for (const cause of ['vencimiento_plazo', 'conclusion_trabajo'] as const) {
            const r = base({ cause });
            expect(r.indemnityYears).toBe(0);
            expect(r.indemnityNotice).toBe(0);
        }
    });

    it('avisa si se usa el art. 161 con un contrato que no es indefinido', () => {
        const r = base({
            cause: 'necesidades_empresa',
            contract: contract({ contractType: 'por_obra' }),
        });
        expect(r.warnings.some((w) => w.includes('requiere contrato indefinido'))).toBe(true);
    });
});

describe('feriado proporcional en días hábiles', () => {
    it('1,25 días hábiles por mes trabajado', () => {
        const d = proportionalVacationDays('2026-01-01', '2026-08-31');
        expect(d).toBeCloseTo(8 * VACATION_DAYS_PER_MONTH, 1);
    });

    it('un año completo devenga 15 días hábiles', () => {
        expect(proportionalVacationDays('2025-01-01', '2025-12-31')).toBeCloseTo(15, 1);
    });

    it('descuenta los días ya tomados', () => {
        const sin = proportionalVacationDays('2025-01-01', '2025-12-31', 0);
        const con = proportionalVacationDays('2025-01-01', '2025-12-31', 5);
        expect(con).toBeCloseTo(sin - 5, 5);
    });

    it('no puede quedar negativo si tomó más de lo devengado', () => {
        expect(proportionalVacationDays('2026-01-01', '2026-03-31', 30)).toBe(0);
    });

    it('suma los días de feriado progresivo acreditados (art. 68)', () => {
        const sin = proportionalVacationDays('2025-01-01', '2025-12-31', 0, 0);
        const con = proportionalVacationDays('2025-01-01', '2025-12-31', 0, 3);
        expect(con).toBeCloseTo(sin + 3, 5);
    });

    it('avisa si se declaran progresivos sin la antigüedad que los respalde', () => {
        const r = base({ startDate: '2024-01-01', progressiveDays: 2 });
        expect(r.warnings.some((w) => w.includes('feriado progresivo'))).toBe(true);
    });
});

describe('🔴 conversión de días hábiles a corridos — el bug central de la fase', () => {
    it('el sábado es inhábil para el feriado (art. 69)', () => {
        const holidays = new Set<string>();
        expect(isVacationWorkday('2026-08-01', holidays)).toBe(false); // sábado
        expect(isVacationWorkday('2026-08-02', holidays)).toBe(false); // domingo
        expect(isVacationWorkday('2026-08-03', holidays)).toBe(true);  // lunes
    });

    it('un festivo tampoco es hábil', () => {
        expect(isVacationWorkday('2026-09-18', new Set(FERIADOS_2026))).toBe(false);
    });

    it('10 días hábiles desde un viernes son 14 corridos', () => {
        // Término viernes 31-07-2026: cruza dos fines de semana completos.
        expect(vacationCalendarDays('2026-07-31', 10, [])).toBe(14);
    });

    it('5 días hábiles sin fines de semana intermedios son 5 corridos', () => {
        // Término domingo 02-08-2026 → arranca lunes y cubre lun-vie.
        expect(vacationCalendarDays('2026-08-02', 5, [])).toBe(5);
    });

    it('un festivo en medio agrega un día corrido más', () => {
        // Término lunes 14-09-2026. El 18 (viernes) es feriado.
        const sinFeriados = vacationCalendarDays('2026-09-14', 5, []);
        const conFeriados = vacationCalendarDays('2026-09-14', 5, FERIADOS_2026);
        expect(conFeriados).toBe(sinFeriados + 1);
    });

    it('los días corridos SIEMPRE son ≥ que los hábiles', () => {
        for (const dias of [1, 3, 7, 10, 15, 21, 30]) {
            const corridos = vacationCalendarDays('2026-07-31', dias, FERIADOS_2026);
            expect(corridos).toBeGreaterThanOrEqual(dias);
        }
    });

    it('una fracción menor a un día hábil se conserva, no se redondea', () => {
        // Término miércoles 08-07-2026 → el jueves 9 es hábil: la fracción cabe entera.
        expect(vacationCalendarDays('2026-07-08', 0.3333, [])).toBeCloseTo(0.33, 2);
    });

    it('0 días hábiles no proyecta nada', () => {
        expect(vacationCalendarDays('2026-07-31', 0, [])).toBe(0);
    });

    it('el pago usa los días CORRIDOS, no los hábiles', () => {
        const r = base({ startDate: '2025-08-01', endDate: '2026-07-31' });
        expect(r.vacationDaysCorridos).toBeGreaterThan(r.vacationDaysHabiles);
        expect(r.vacationPay).toBe(Math.round((1000000 / 30) * r.vacationDaysCorridos));
        // Lo que la calculadora vieja habría pagado, tratando hábiles como corridos:
        const viejo = Math.round((1000000 / 30) * r.vacationDaysHabiles);
        expect(r.vacationPay).toBeGreaterThan(viejo);
    });
});

describe('totales del finiquito', () => {
    it('suma indemnizaciones, feriado y la liquidación del último mes', () => {
        const r = base({ lastPayrollNet: 800000 });
        expect(r.totalEarnings).toBe(
            r.indemnityYears + r.indemnityNotice + r.vacationPay + r.lastPayrollNet,
        );
    });

    it('descuenta los anticipos pendientes', () => {
        const r = base({ deductions: [{ name: 'Anticipo julio', amount: 150000 }] });
        expect(r.totalDeductions).toBe(150000);
        expect(r.totalSeverance).toBe(r.totalEarnings - 150000);
    });

    it('avisa si el finiquito queda negativo', () => {
        const r = base({
            cause: 'renuncia',
            deductions: [{ name: 'Préstamo', amount: 99999999 }],
        });
        expect(r.warnings.some((w) => w.includes('negativo'))).toBe(true);
    });

    it('sin remuneración no calcula indemnizaciones y avisa', () => {
        const r = base({ lastRemuneration: 0 });
        expect(r.indemnityYears).toBe(0);
        expect(r.warnings.some((w) => w.includes('Sin última remuneración'))).toBe(true);
    });

    it('avisa si el término es anterior al ingreso', () => {
        const r = base({ startDate: '2026-07-31', endDate: '2026-01-01' });
        expect(r.warnings.some((w) => w.includes('anterior a la de ingreso'))).toBe(true);
    });
});

describe('regresión: el finiquito que emitió la calculadora vieja', () => {
    // Caso real generado el 14-07-2026 (tenant Valar, prueba): ingreso 01-07-2026,
    // término 08-07-2026, remuneración $1.500.000, necesidades de la empresa sin
    // aviso. Sirve para dejar por escrito en qué difiere el motor nuevo.
    const r = calculateSeverance({
        contract: contract({ effectiveFrom: '2026-07-01' }),
        startDate: '2026-07-01',
        endDate: '2026-07-08',
        cause: 'necesidades_empresa',
        noticeGiven: false,
        lastRemuneration: 1500000,
        ufValue: UF,
        holidays: FERIADOS_2026,
    });

    it('sin año cumplido no hay indemnización por años de servicio', () => {
        expect(r.yearsOfService).toBe(0);
        expect(r.indemnityYears).toBe(0);
    });

    it('el aviso previo sustitutivo es un mes completo, sin proporcionalidad', () => {
        expect(r.indemnityNotice).toBe(1500000);
    });

    it('el feriado devengado son 8/30 de mes × 1,25', () => {
        expect(r.vacationDaysHabiles).toBeCloseTo((8 / 30) * 1.25, 2);
    });

    it('en un período tan corto la proyección casi no cambia el monto', () => {
        // La diferencia con la calculadora vieja aparece cuando el feriado cruza
        // fines de semana; en una fracción menor a un día hábil es marginal.
        expect(Math.abs(r.vacationPay - 16438)).toBeLessThan(500);
    });
});

// ⚠️ PENDIENTE — anclar contra un finiquito REAL emitido por un tercero. Todo lo
// de arriba verifica la normativa tal como la leí, no el comportamiento de un
// emisor real. Es la misma distinción que en su momento dejó pasar la hora extra
// 4× sobrestimada en el motor de liquidación: los tests sintéticos se derivan de
// la misma interpretación que quieren validar. Basta UN finiquito real.
describe.todo('anclaje contra finiquito real de un tercero');
