// Remuneraciones F4 — matemática del reemplazo de la estimación (ADR-010).
//
// Puro y sin Supabase, patrón `financeMath.ts`. Acá vive lo que decide cuánto
// costo real va a cada obra y cómo se lee la desviación contra el presupuesto:
// es la aritmética de la que depende el número que Steven quiere leer, así que va
// testeada aparte del emisor.

/** Un día-persona ya devengado como estimación, con la obra a la que se imputó. */
export interface LaborDayFact {
    /** `{userId}:{yyyy-MM-dd}` — la fecha del día trabajado, no la de emisión. */
    sourceId: string;
    contractId: string | null;
    contractName: string | null;
    /** Neto vivo del día (después de reversos). Puede ser 0 si ya se neteó. */
    amountNet: number;
}

export interface ContractShare {
    contractId: string | null;
    contractName: string | null;
    /** Días trabajados imputados a esta obra. */
    days: number;
    /** Costo real que le corresponde, ya redondeado a peso. */
    amount: number;
}

/**
 * Reparte el costo real de un trabajador entre las obras donde tuvo días
 * (decisión 2 del ADR-010: proporcional a los días de cada contrato).
 *
 * El redondeo se ajusta en la obra con más días para que la suma de las partes sea
 * EXACTAMENTE el total: un peso perdido por redondeo dejaría el reemplazo sin
 * cuadrar contra la estimación que reversa, y el margen arrastraría el residuo.
 */
export function splitCostByContract(
    employerCost: number,
    facts: LaborDayFact[],
): ContractShare[] {
    const total = Math.round(Number(employerCost) || 0);
    if (!total) return [];

    // Días por obra. `null` es una obra válida ("sin asignar"): se conserva en vez
    // de repartirse, porque esconderlo haría invisible un problema de datos.
    const byContract = new Map<string, { contractId: string | null; contractName: string | null; days: number }>();
    for (const f of facts) {
        const key = f.contractId ?? '__none__';
        const cur = byContract.get(key) || { contractId: f.contractId ?? null, contractName: f.contractName ?? null, days: 0 };
        cur.days += 1;
        // Si algún día trajo nombre y otro no, se conserva el que exista.
        if (!cur.contractName && f.contractName) cur.contractName = f.contractName;
        byContract.set(key, cur);
    }

    const grupos = [...byContract.values()].sort((a, b) => b.days - a.days);
    // Sin ningún día imputado no hay proporción posible: todo al pool (contrato
    // null), que es como el ledger representa "sin obra".
    if (!grupos.length) return [{ contractId: null, contractName: null, days: 0, amount: total }];

    const totalDays = grupos.reduce((s, g) => s + g.days, 0);
    const shares: ContractShare[] = grupos.map((g) => ({
        contractId: g.contractId,
        contractName: g.contractName,
        days: g.days,
        amount: Math.round((total * g.days) / totalDays),
    }));

    // Ajuste del residuo en la obra con más días (la primera, ya ordenada).
    const suma = shares.reduce((s, x) => s + x.amount, 0);
    if (suma !== total) shares[0].amount += total - suma;
    return shares;
}

/** Extrae el `yyyy-MM` de un source_id `{userId}:{yyyy-MM-dd}`. */
export function monthOfLaborSourceId(sourceId: string): string | null {
    const idx = sourceId.lastIndexOf(':');
    if (idx < 0) return null;
    const date = sourceId.slice(idx + 1);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : null;
}

// ── Desviación presupuesto vs gasto real ────────────────────────────────────

export type DeviationDirection = 'ahorro' | 'exceso' | 'exacto';

export interface Deviation {
    budget: number;
    actual: number;
    /** Positivo = ahorro (gastaste menos); negativo = exceso. */
    delta: number;
    /** Magnitud absoluta, para mostrar sin signo junto a la frase. */
    magnitude: number;
    direction: DeviationDirection;
    /** Porcentaje sobre el presupuesto. 0 si no hay presupuesto cargado. */
    pct: number;
    /** Frase en lenguaje llano — el requisito textual de Steven. */
    message: string;
    /** Sin presupuesto cargado no hay desviación que leer, solo gasto. */
    hasBudget: boolean;
}

const CLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
        .format(Math.round(n || 0));

/**
 * Desviación con lenguaje directo (decisión 3 del ADR-010).
 *
 * El presupuesto de planilla se carga HOLGADO a propósito, así que lo que importa
 * no es el porcentaje de ejecución sino la diferencia con signo, dicha en
 * castellano: "te ahorraste $150.000" / "estás pagando $220.000 más".
 *
 * Sin presupuesto cargado NO se inventa una desviación de 100%: se dice que no hay
 * presupuesto. Un 100% de ahorro sobre cero sería una lectura falsa.
 */
export function budgetDeviation(budget: number, actual: number): Deviation {
    const b = Math.round(Number(budget) || 0);
    const a = Math.round(Number(actual) || 0);
    const delta = b - a;
    const magnitude = Math.abs(delta);
    const hasBudget = b > 0;
    const pct = hasBudget ? Math.round((delta / b) * 1000) / 10 : 0;

    let direction: DeviationDirection = 'exacto';
    if (delta > 0) direction = 'ahorro';
    else if (delta < 0) direction = 'exceso';

    let message: string;
    if (!hasBudget) {
        message = a > 0
            ? `Sin presupuesto cargado: llevas ${CLP(a)} de gasto real.`
            : 'Sin presupuesto cargado y sin gasto registrado.';
    } else if (direction === 'ahorro') {
        message = `Te ahorraste ${CLP(magnitude)} respecto de lo presupuestado.`;
    } else if (direction === 'exceso') {
        message = `Estás pagando ${CLP(magnitude)} más de lo presupuestado.`;
    } else {
        message = 'El gasto real coincide exactamente con lo presupuestado.';
    }

    return { budget: b, actual: a, delta, magnitude, direction, pct, message, hasBudget };
}

/**
 * Obligación de caja que deja una liquidación al cerrarse (ADR-013).
 *
 * Es el costo empresa MENOS lo que el trabajador ya recibió como anticipo. El
 * anticipo descuenta del líquido pero NO rebaja los haberes, así que
 * `employerCost` incluye esa plata: proyectarla entera la contaría dos veces
 * —una en el `payable` del propio anticipo y otra acá— y el flujo de caja diría
 * que falta por pagar algo que ya salió del banco.
 *
 * Los dos payables se reparten el mismo desembolso: el del anticipo se apaga al
 * transferirlo, éste al pagar la planilla. Sumados dan el costo empresa completo,
 * ocurran en el orden que ocurran.
 *
 * Nunca negativo: si los anticipos superan al costo empresa —dato inconsistente,
 * no un caso de negocio— la obligación es cero, no un pago al revés.
 */
export function payrollPayableAmount(employerCost: number, advancesAmount: number): number {
    const cost = Math.round(Number(employerCost) || 0);
    const advanced = Math.round(Number(advancesAmount) || 0);
    if (cost <= 0) return 0;
    return Math.max(0, cost - Math.max(0, advanced));
}
