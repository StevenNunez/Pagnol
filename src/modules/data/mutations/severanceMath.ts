import type { EmploymentContract } from '@/modules/core/lib/data';

// =============================================================================
// Remuneraciones F5 — Motor de finiquitos (RFC-003 / ADR-012)
//
// Puro: sin Supabase, sin `new Date()` implícito. Todo entra por parámetro —
// incluidos la UF del período y los festivos— para que un test sea reproducible.
//
// Reemplaza la calculadora de `attendance/severance`, que además de no persistir
// nada tenía cuatro defectos con consecuencia en plata:
//   1. El feriado proporcional se pagaba como si los días fueran CORRIDOS cuando
//      la ley los define HÁBILES (art. 67) — pagaba ~40% de menos ese concepto.
//   2. No existía el tope de 90 UF del art. 172 sobre la base de indemnización.
//   3. `fracción >= 6 meses` daba un año completo, pero el art. 163 exige
//      fracción SUPERIOR a seis meses.
//   4. No contemplaba el feriado progresivo del art. 68.
//
// ⚠️ VERIFICADO CONTRA NORMATIVA, NO ANCLADO A UN DOCUMENTO REAL. A diferencia
// del motor de liquidación —que reproduce al peso 3 liquidaciones emitidas por un
// tercero— acá no hubo finiquito real disponible. Los tests fijan la mecánica
// según la ley; el primer finiquito real que aparezca vale como ancla y puede
// corregir supuestos (fue exactamente así como se destapó que la hora extra
// estaba 4× sobrestimada). Ver el `describe.todo` reservado en los tests.
// =============================================================================

/** Autor de sistema de los hechos de finiquito (Art. 5). */
export const SEVERANCE_SYSTEM_AUTHOR = 'Sistema (finiquitos)';

/**
 * Tope de la base de cálculo de las indemnizaciones LEGALES (art. 172): la última
 * remuneración mensual no puede exceder 90 UF para estos efectos.
 *
 * ⚠️ Solo topa años de servicio y aviso previo. El feriado proporcional, la
 * gratificación proporcional y el sueldo del último mes se pagan con la
 * remuneración REAL, sin tope — confundirlos le quitaría plata al trabajador.
 */
export const SEVERANCE_BASE_CAP_UF = 90;

/** Tope de años de servicio indemnizables (art. 163, contratos post 14-08-1981). */
export const SEVERANCE_MAX_YEARS = 11;

/** Feriado legal anual en días HÁBILES (art. 67) y su equivalente mensual. */
export const VACATION_DAYS_PER_YEAR = 15;
export const VACATION_DAYS_PER_MONTH = VACATION_DAYS_PER_YEAR / 12; // 1,25

/** Divisor mensual, el mismo del ledger y de la liquidación. */
export const SEVERANCE_MONTH_DAYS = 30;

// ── Causales ────────────────────────────────────────────────────────────────

export type TerminationCause =
    | 'mutuo_acuerdo'        // art. 159 n°1
    | 'renuncia'             // art. 159 n°2
    | 'muerte'               // art. 159 n°3
    | 'vencimiento_plazo'    // art. 159 n°4
    | 'conclusion_trabajo'   // art. 159 n°5
    | 'caso_fortuito'        // art. 159 n°6
    | 'despido_disciplinario'// art. 160 (sin indemnización)
    | 'necesidades_empresa'  // art. 161 inc. 1
    | 'desahucio';           // art. 161 inc. 2

export const TERMINATION_CAUSE_LABELS: Record<TerminationCause, string> = {
    mutuo_acuerdo: 'Art. 159 N° 1: Mutuo acuerdo de las partes',
    renuncia: 'Art. 159 N° 2: Renuncia del trabajador',
    muerte: 'Art. 159 N° 3: Muerte del trabajador',
    vencimiento_plazo: 'Art. 159 N° 4: Vencimiento del plazo convenido',
    conclusion_trabajo: 'Art. 159 N° 5: Conclusión del trabajo o servicio',
    caso_fortuito: 'Art. 159 N° 6: Caso fortuito o fuerza mayor',
    despido_disciplinario: 'Art. 160: Causales imputables al trabajador',
    necesidades_empresa: 'Art. 161 inc. 1: Necesidades de la empresa',
    desahucio: 'Art. 161 inc. 2: Desahucio del empleador',
};

/**
 * Solo el art. 161 genera indemnización por años de servicio. Se declara como
 * lista explícita y no como `else` porque agregar una causal nueva debe obligar a
 * decidir si paga o no — la regla del dominio: un `else` genérico es un bug.
 */
export const CAUSES_WITH_INDEMNITY: ReadonlyArray<TerminationCause> = [
    'necesidades_empresa', 'desahucio',
];

/** El aviso previo sustitutivo también nace del art. 161 (30 días o su pago). */
export const CAUSES_WITH_NOTICE: ReadonlyArray<TerminationCause> = [
    'necesidades_empresa', 'desahucio',
];

// ── Entradas y salida ───────────────────────────────────────────────────────

export interface SeveranceDeduction { name: string; amount: number }

export interface SeveranceInput {
    contract: EmploymentContract;
    /** Ingreso a la empresa (`YYYY-MM-DD`), no el inicio del anexo vigente. */
    startDate: string;
    /** Término del contrato (`YYYY-MM-DD`). */
    endDate: string;
    cause: TerminationCause;
    /** ¿Se dio el aviso de 30 días? Si no, se paga la indemnización sustitutiva. */
    noticeGiven: boolean;
    /**
     * Base del art. 172: toda cantidad que percibe el trabajador al término,
     * incluidas cotizaciones de su cargo y regalías avaluadas en dinero.
     * EXCLUYE horas extra, asignación familiar y beneficios esporádicos.
     */
    lastRemuneration: number;
    ufValue: number;
    /** Días de feriado (hábiles) ya tomados en el período. */
    vacationDaysTaken?: number;
    /**
     * Días de feriado progresivo ACREDITADOS por el trabajador (art. 68).
     * Se declara, no se calcula: el derecho exige 10 años con uno o más
     * empleadores —que este sistema no conoce— y el trabajador debe acreditarlos.
     * Inventarlo sería peor que pedirlo.
     */
    progressiveDays?: number;
    /** Festivos `YYYY-MM-DD` para proyectar el feriado en el calendario. */
    holidays?: string[];
    /** Líquido de la liquidación del último mes, si el finiquito la incluye. */
    lastPayrollNet?: number;
    /** Anticipos pendientes y otros descuentos pactados. */
    deductions?: SeveranceDeduction[];
}

export interface SeveranceResult {
    /** Años de servicio computados (con la fracción > 6 meses ya resuelta). */
    yearsOfService: number;
    /** Los que efectivamente se indemnizan (tope de 11). */
    indemnifiableYears: number;
    /** Base del art. 172 después del tope de 90 UF. */
    cappedBase: number;
    /** Base sin topar, para poder mostrar la diferencia. */
    uncappedBase: number;
    indemnityYears: number;
    indemnityNotice: number;
    /** Feriado proporcional en días HÁBILES devengados y no tomados. */
    vacationDaysHabiles: number;
    /** Los mismos días proyectados en el calendario → días CORRIDOS a pagar. */
    vacationDaysCorridos: number;
    vacationPay: number;
    lastPayrollNet: number;
    totalEarnings: number;
    deductions: SeveranceDeduction[];
    totalDeductions: number;
    totalSeverance: number;
    warnings: string[];
}

const round = (n: number) => Math.round(n);

// ── Fechas (puras, sin dependencias) ────────────────────────────────────────

function parseIso(iso: string): Date {
    // Mediodía UTC: inmune a DST y a los saltos de zona horaria.
    return new Date(`${iso}T12:00:00Z`);
}

function toIso(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
    const d = parseIso(iso);
    d.setUTCDate(d.getUTCDate() + days);
    return toIso(d);
}

/** Días corridos entre dos fechas, ambos extremos incluidos. */
export function daysBetween(startIso: string, endIso: string): number {
    const a = parseIso(startIso).getTime();
    const b = parseIso(endIso).getTime();
    return Math.floor((b - a) / 86400000) + 1;
}

/**
 * Meses de servicio con su fracción, en base 30.
 *
 * Se cuentan meses calendario completos y el resto se expresa como fracción de
 * mes: es lo que necesita el feriado proporcional (1,25 días por mes) y también
 * la regla de "fracción superior a seis meses" del art. 163.
 */
export function monthsOfService(startIso: string, endIso: string): number {
    const s = parseIso(startIso);
    const e = parseIso(endIso);
    let months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12
        + (e.getUTCMonth() - s.getUTCMonth());
    const dayDiff = e.getUTCDate() - s.getUTCDate();
    // El día de término se cuenta como trabajado, de ahí el +1.
    let fraction = (dayDiff + 1) / SEVERANCE_MONTH_DAYS;
    if (fraction < 0) { months -= 1; fraction += 1; }
    return months + fraction;
}

/**
 * Años de servicio indemnizables (art. 163): años completos, más uno si la
 * fracción restante es **superior** a seis meses.
 *
 * El `>` es literal y no un detalle: con `>=`, alguien con exactamente 6 meses de
 * fracción cobraba un año entero de más.
 */
export function yearsOfService(startIso: string, endIso: string): number {
    const months = monthsOfService(startIso, endIso);
    if (months <= 0) return 0;
    const fullYears = Math.floor(months / 12);
    const remainder = months - fullYears * 12;
    return remainder > 6 ? fullYears + 1 : fullYears;
}

// ── Piezas del cálculo ──────────────────────────────────────────────────────

/**
 * Base de las indemnizaciones legales con el tope de 90 UF (art. 172).
 * Solo aplica a años de servicio y aviso previo.
 */
export function cappedSeveranceBase(lastRemuneration: number, ufValue: number): number {
    const base = Number(lastRemuneration) || 0;
    if (base <= 0) return 0;
    if (!Number.isFinite(ufValue) || ufValue <= 0) return base; // sin UF no se topa; se avisa
    return Math.min(base, SEVERANCE_BASE_CAP_UF * ufValue);
}

/**
 * Feriado proporcional en días HÁBILES: 1,25 por mes de servicio, menos los ya
 * tomados, más los progresivos acreditados.
 */
export function proportionalVacationDays(
    startIso: string,
    endIso: string,
    daysTaken = 0,
    progressiveDays = 0,
): number {
    const months = monthsOfService(startIso, endIso);
    if (months <= 0) return 0;
    const earned = months * VACATION_DAYS_PER_MONTH + (Number(progressiveDays) || 0);
    return Math.max(0, earned - (Number(daysTaken) || 0));
}

/** ¿Es hábil? Domingo y **sábado** son inhábiles para el feriado (art. 69). */
export function isVacationWorkday(iso: string, holidays: ReadonlySet<string>): boolean {
    const dow = parseIso(iso).getUTCDay(); // 0 domingo … 6 sábado
    if (dow === 0 || dow === 6) return false;
    return !holidays.has(iso);
}

/**
 * Convierte días hábiles de feriado en los días CORRIDOS que se pagan.
 *
 * Es el paso que la calculadora anterior no hacía y por el que pagaba de menos.
 * La Dirección del Trabajo lo dice explícito: los días se cuentan desde el día
 * siguiente al término del contrato, y la compensación debe sumar —además de los
 * hábiles— los sábados, domingos y festivos que el período atraviese.
 *
 * La fracción del último día se conserva en vez de redondear: son pesos del
 * trabajador y el redondeo sistemático siempre cae para el mismo lado.
 */
export function vacationCalendarDays(
    endIso: string,
    habilDays: number,
    holidays: readonly string[] = [],
): number {
    const target = Number(habilDays) || 0;
    if (target <= 0) return 0;
    const set = new Set(holidays);

    let cursor = addDays(endIso, 1);   // desde el día SIGUIENTE al término
    let habiles = 0;
    let corridos = 0;
    // Cota defensiva: 15 días hábiles anuales × 11 años + progresivos, con holgura
    // para los inhábiles intercalados. Evita un bucle infinito si algo llega mal.
    const MAX = 4000;

    while (habiles < target && corridos < MAX) {
        corridos += 1;
        if (isVacationWorkday(cursor, set)) habiles += 1;
        if (habiles >= target) break;
        cursor = addDays(cursor, 1);
    }

    // Si el último día hábil se usó solo en parte, se devuelve esa parte.
    const excess = habiles - target;
    return Math.round((corridos - Math.max(0, excess)) * 100) / 100;
}

// ── El motor ────────────────────────────────────────────────────────────────

/**
 * Finiquito completo.
 *
 * Orden del cálculo:
 *   1. antigüedad → años indemnizables (tope 11)
 *   2. base del art. 172 → tope de 90 UF
 *   3. indemnización por años de servicio (solo art. 161)
 *   4. aviso previo sustitutivo (art. 161 sin aviso)
 *   5. feriado proporcional: días hábiles → proyección a corridos → monto
 *   6. liquidación del último mes, si se integra
 *   7. descuentos → total
 */
export function calculateSeverance(input: SeveranceInput): SeveranceResult {
    const {
        contract, startDate, endDate, cause, noticeGiven,
        lastRemuneration, ufValue,
        vacationDaysTaken = 0, progressiveDays = 0, holidays = [],
        lastPayrollNet = 0, deductions = [],
    } = input;
    const warnings: string[] = [];

    if (!(ufValue > 0))
        warnings.push('Sin valor de UF: no se aplicó el tope de 90 UF a la base de indemnización.');
    if (!(Number(lastRemuneration) > 0))
        warnings.push('Sin última remuneración: las indemnizaciones quedaron en cero.');
    if (endDate < startDate)
        warnings.push('La fecha de término es anterior a la de ingreso: revisa las fechas.');

    // ── 1-2. Antigüedad y base
    const years = yearsOfService(startDate, endDate);
    const indemnifiableYears = Math.min(years, SEVERANCE_MAX_YEARS);
    if (years > SEVERANCE_MAX_YEARS)
        warnings.push(`La antigüedad es de ${years} años: la indemnización se topa en ${SEVERANCE_MAX_YEARS}.`);

    const uncappedBase = Number(lastRemuneration) || 0;
    const cappedBase = cappedSeveranceBase(uncappedBase, ufValue);
    if (cappedBase < uncappedBase)
        warnings.push('La remuneración supera las 90 UF: la indemnización se calculó sobre ese tope (art. 172).');

    // ── 3-4. Indemnizaciones legales
    const paysIndemnity = CAUSES_WITH_INDEMNITY.includes(cause);
    const paysNotice = CAUSES_WITH_NOTICE.includes(cause) && !noticeGiven;

    const indemnityYears = paysIndemnity ? round(cappedBase * indemnifiableYears) : 0;
    const indemnityNotice = paysNotice ? round(cappedBase) : 0;

    if (paysIndemnity && contract.contractType !== 'indefinido') {
        warnings.push(
            `La causal del art. 161 requiere contrato indefinido y este es ${contract.contractType.replace('_', ' ')}. `
            + 'Revisa la causal.',
        );
    }

    // ── 5. Feriado proporcional: la corrección central de esta fase
    const vacationDaysHabiles = proportionalVacationDays(
        startDate, endDate, vacationDaysTaken, progressiveDays,
    );
    const vacationDaysCorridos = vacationCalendarDays(endDate, vacationDaysHabiles, holidays);
    // Se paga con la remuneración REAL, sin el tope de 90 UF (art. 172 solo topa
    // las indemnizaciones legales).
    const vacationPay = round((uncappedBase / SEVERANCE_MONTH_DAYS) * vacationDaysCorridos);

    if (progressiveDays > 0 && years < 10) {
        warnings.push(
            'Se declararon días de feriado progresivo pero la antigüedad en la empresa es menor a 10 años: '
            + 'el derecho exige acreditar 10 años con uno o más empleadores (art. 68).',
        );
    }

    // ── 6-7. Totales
    const lastNet = Math.max(0, Number(lastPayrollNet) || 0);
    const totalEarnings = indemnityYears + indemnityNotice + vacationPay + lastNet;
    const totalDeductions = deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
    const totalSeverance = totalEarnings - totalDeductions;

    if (totalSeverance < 0)
        warnings.push('El finiquito resultó negativo: revisa los descuentos.');

    return {
        yearsOfService: years,
        indemnifiableYears,
        cappedBase: round(cappedBase),
        uncappedBase: round(uncappedBase),
        indemnityYears,
        indemnityNotice,
        vacationDaysHabiles: Math.round(vacationDaysHabiles * 100) / 100,
        vacationDaysCorridos,
        vacationPay,
        lastPayrollNet: lastNet,
        totalEarnings,
        deductions,
        totalDeductions,
        totalSeverance,
        warnings,
    };
}
