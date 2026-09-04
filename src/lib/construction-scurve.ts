import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

/**
 * Curva S de la obra: cuánto se planificó gastar/avanzar hasta cada fecha, y
 * cuánto se avanzó de verdad.
 *
 * Es el gráfico que un gerente busca primero, y también el más fácil de dibujar
 * mal: basta acumular en el eje equivocado o repartir el avance de una partida
 * terminada sobre días en que ya no se trabajaba para producir una curva
 * perfectamente creíble y falsa. Por eso toda la matemática vive acá, separada
 * de la pantalla y con pruebas.
 *
 * **Se pondera por MONTO** (cantidad × precio unitario), igual que
 * `rollupProgress`: sumar metros de cable con metros cúbicos de hormigón no
 * significa nada.
 *
 * **Nota sobre la línea base:** hoy lo planificado se reparte entre las fechas
 * planificadas *vigentes* de cada partida. Cuando exista `work_item_baselines`
 * (F2 del RFC-006), la curva planificada debe leerse de ahí: si no, cada
 * reprogramación mueve la curva planificada hacia atrás y el atraso pasado
 * desaparece solo.
 */

export interface CurvaItem {
    id: string;
    quantity?: number | null;
    unitPrice?: number | null;
    progress?: number | null;
    plannedStartDate?: Date | string | null;
    plannedEndDate?: Date | string | null;
}

export interface CurvaAvance {
    workItemId: string;
    date: Date | string;
    /** Cantidad avanzada en ese registro (no porcentaje). */
    quantity: number;
}

export interface PuntoCurva {
    /** Día del punto. */
    fecha: Date;
    /** Monto planificado acumulado hasta esa fecha. */
    planificado: number;
    /** Monto realmente ejecutado hasta esa fecha. `null` a futuro: no se dibuja. */
    real: number | null;
}

const toDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

const monto = (i: CurvaItem) => (i.quantity || 0) * (i.unitPrice || 0);

/**
 * Construye la curva S.
 *
 * - **Planificado:** cada partida reparte su monto en partes iguales entre sus
 *   días planificados. Una partida sin fechas no aporta a la curva planificada
 *   (no se inventa un calendario), pero sí al total de la obra.
 * - **Real:** se acumulan los avances registrados en su propia fecha. Es el dato
 *   duro; no se reparte ni se suaviza.
 * - El tramo futuro deja `real` en `null` para que la línea se corte hoy en vez
 *   de desplomarse a cero, que se leería como una obra detenida.
 */
export function construirCurvaS(
    items: CurvaItem[],
    avances: CurvaAvance[],
    hoy: Date = new Date(),
    maxPuntos = 60,
): PuntoCurva[] {
    const conFechas = items.filter(i => toDate(i.plannedStartDate) && toDate(i.plannedEndDate));
    const fechas: Date[] = [];
    for (const i of conFechas) {
        fechas.push(startOfDay(toDate(i.plannedStartDate)!), startOfDay(toDate(i.plannedEndDate)!));
    }
    for (const a of avances) {
        const d = toDate(a.date);
        if (d) fechas.push(startOfDay(d));
    }
    if (fechas.length === 0) return [];

    const inicio = new Date(Math.min(...fechas.map(f => f.getTime())));
    const fin = new Date(Math.max(...fechas.map(f => f.getTime())));
    const diasTotales = Math.max(1, differenceInCalendarDays(fin, inicio));

    // Se muestrea a un número acotado de puntos: una obra de dos años son 700+
    // días y el gráfico no gana nada con esa resolución.
    const paso = Math.max(1, Math.ceil(diasTotales / maxPuntos));

    // Monto planificado por día, precomputado
    const planPorDia = new Map<number, number>();
    for (const i of conFechas) {
        const ini = startOfDay(toDate(i.plannedStartDate)!);
        const term = startOfDay(toDate(i.plannedEndDate)!);
        const dias = Math.max(1, differenceInCalendarDays(term, ini) + 1);
        const porDia = monto(i) / dias;
        for (let d = 0; d < dias; d++) {
            const k = startOfDay(addDays(ini, d)).getTime();
            planPorDia.set(k, (planPorDia.get(k) || 0) + porDia);
        }
    }

    // Monto real por día: la cantidad avanzada × su precio unitario
    const precioDe = new Map(items.map(i => [i.id, i.unitPrice || 0]));
    const realPorDia = new Map<number, number>();
    for (const a of avances) {
        const d = toDate(a.date);
        if (!d) continue;
        const k = startOfDay(d).getTime();
        realPorDia.set(k, (realPorDia.get(k) || 0) + (a.quantity || 0) * (precioDe.get(a.workItemId) || 0));
    }

    const hoyK = startOfDay(hoy).getTime();
    const puntos: PuntoCurva[] = [];
    let accPlan = 0;
    let accReal = 0;

    for (let d = 0; d <= diasTotales; d++) {
        const fecha = startOfDay(addDays(inicio, d));
        accPlan += planPorDia.get(fecha.getTime()) || 0;
        accReal += realPorDia.get(fecha.getTime()) || 0;
        const esUltimo = d === diasTotales;
        if (d % paso === 0 || esUltimo) {
            puntos.push({
                fecha,
                planificado: Math.round(accPlan),
                // A futuro no hay "real": cortar la línea es honesto, llevarla a
                // cero diría que la obra se detuvo.
                real: fecha.getTime() <= hoyK ? Math.round(accReal) : null,
            });
        }
    }
    return puntos;
}

/**
 * Índice de rendimiento del cronograma (SPI): lo ejecutado dividido por lo que
 * debería estar ejecutado a la fecha, en monto.
 *
 * Mayor que 1 = adelantado. Devuelve `null` cuando aún no hay nada planificado
 * hasta hoy: dividir por cero daría "infinitamente adelantado" el primer día.
 */
export function spiALaFecha(puntos: PuntoCurva[], hoy: Date = new Date()): number | null {
    const hoyK = startOfDay(hoy).getTime();
    const pasados = puntos.filter(p => p.fecha.getTime() <= hoyK && p.real !== null);
    if (pasados.length === 0) return null;
    const ultimo = pasados[pasados.length - 1];
    if (!ultimo.planificado) return null;
    return (ultimo.real ?? 0) / ultimo.planificado;
}

/** Monto planificado y ejecutado a la fecha, para las tarjetas de resumen. */
export function montosALaFecha(puntos: PuntoCurva[], hoy: Date = new Date()): { planificado: number; real: number } {
    const hoyK = startOfDay(hoy).getTime();
    const pasados = puntos.filter(p => p.fecha.getTime() <= hoyK && p.real !== null);
    if (pasados.length === 0) return { planificado: 0, real: 0 };
    const u = pasados[pasados.length - 1];
    return { planificado: u.planificado, real: u.real ?? 0 };
}
