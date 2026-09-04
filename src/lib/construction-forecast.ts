import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

/**
 * Proyección de término de una partida a partir de su ritmo real de avance.
 *
 * El panel de Control de Obras mostraba solo qué partidas estaban pendientes de
 * revisión, sin decir **cuándo** terminan las que están en ejecución. La fecha
 * planificada sola no responde eso: dice cuándo *debería* terminar, no cuándo va
 * a terminar al ritmo que lleva.
 *
 * Toda la matemática vive acá, separada de la pantalla, porque una proyección
 * mal calculada se ve perfectamente razonable en la UI: un error de un día por
 * zona horaria o un ritmo mal dividido produce una fecha creíble y equivocada.
 * (Los desfases de un día por zona horaria ya mordieron cuatro veces en este
 * proyecto, por eso todo el cálculo es en días calendario locales.)
 */

/** De dónde sale la fecha que se muestra. Nunca se presenta una proyección como si fuera un dato duro. */
export type ForecastKind =
    /** Proyectada con el ritmo real de avance. */
    | 'projected'
    /** No hay ritmo medible todavía: se muestra la fecha planificada. */
    | 'planned'
    /** Ni ritmo ni planificación: no se inventa una fecha. */
    | 'unknown';

export interface ForecastInput {
    /** 0–100. */
    progress: number;
    plannedStartDate?: Date | string | null;
    plannedEndDate?: Date | string | null;
    actualStartDate?: Date | string | null;
    /** Fecha del PRIMER avance registrado de la partida, si hay alguno. */
    firstProgressDate?: Date | string | null;
}

export interface Forecast {
    kind: ForecastKind;
    /** Fecha estimada de término. `null` cuando no hay base para decir nada. */
    date: Date | null;
    /** Días respecto de la fecha planificada. Positivo = atrasada. `null` si no hay plan con qué comparar. */
    deviationDays: number | null;
    /**
     * Cuántos días de historia sustentan la proyección (`null` si no hay proyección).
     *
     * Con un solo día, la proyección extrapola de un único punto: una partida que
     * registró 80% hoy proyecta terminar mañana. La cuenta es correcta y la
     * conclusión es frágil, así que el dato viaja a la pantalla para que lo diga
     * en vez de presentar las dos con la misma cara.
     */
    basisDays: number | null;
}

/**
 * Tope de la proyección. Una partida que avanzó 1% en tres meses proyecta a 25
 * años: la fecha sería correcta y completamente inútil, y se leería como un bug.
 * Por encima del tope se devuelve la fecha planificada (o nada), que es más
 * honesto que un año absurdo.
 */
const MAX_PROJECTION_DAYS = 365 * 3;

const toDate = (v: Date | string | null | undefined): Date | null => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Fecha estimada de término de una partida.
 *
 * El ritmo se mide desde que la partida **realmente** empezó (primer avance
 * registrado, o su fecha de inicio real), no desde su inicio planificado: si
 * empezó dos semanas tarde, proyectar desde el plan repartiría ese atraso como
 * si fuera lentitud y daría una fecha más optimista que la realidad.
 */
export function forecastCompletion(input: ForecastInput, today: Date = new Date()): Forecast {
    const plannedEnd = toDate(input.plannedEndDate);
    const hoy = startOfDay(today);

    const planned = (): Forecast => ({
        kind: plannedEnd ? 'planned' : 'unknown',
        date: plannedEnd,
        deviationDays: null, // comparar el plan contra sí mismo no dice nada
        basisDays: null,
    });

    const progress = Number.isFinite(input.progress) ? input.progress : 0;
    if (progress <= 0 || progress >= 100) return planned();

    const start = toDate(input.firstProgressDate) ?? toDate(input.actualStartDate) ?? toDate(input.plannedStartDate);
    if (!start) return planned();

    // Al menos un día: una partida que empezó y avanzó hoy mismo tiene un ritmo
    // medible de un día, no de cero (dividir por cero daría Infinity).
    const elapsed = Math.max(1, differenceInCalendarDays(hoy, startOfDay(start)));
    const ratePerDay = progress / elapsed;
    const remainingDays = Math.ceil((100 - progress) / ratePerDay);

    if (!Number.isFinite(remainingDays) || remainingDays > MAX_PROJECTION_DAYS) return planned();

    const date = addDays(hoy, remainingDays);
    return {
        kind: 'projected',
        date,
        deviationDays: plannedEnd ? differenceInCalendarDays(date, startOfDay(plannedEnd)) : null,
        basisDays: elapsed,
    };
}

/** En qué está una partida hoy, según su estado y su avance. */
export type ActivityBucket =
    | 'running'    // empezó y no termina
    | 'pending'    // esperando revisión de calidad
    | 'notStarted' // creada, sin avance
    | 'done'
    | 'rejected';

export function activityBucket(item: { status: string; progress: number }): ActivityBucket {
    if (item.status === 'rejected') return 'rejected';
    if (item.status === 'pending-quality-review') return 'pending';
    if (item.status === 'completed' || item.progress >= 100) return 'done';
    return item.progress > 0 ? 'running' : 'notStarted';
}

/**
 * Días de atraso de una partida **que no ha terminado**, contra su fecha
 * planificada. Solo cuenta el atraso ya consumado (la fecha ya pasó); lo que
 * todavía está por vencer no es atraso.
 */
export function overdueDays(
    item: { progress: number; plannedEndDate?: Date | string | null },
    today: Date = new Date(),
): number {
    const end = toDate(item.plannedEndDate);
    if (!end || item.progress >= 100) return 0;
    const diff = differenceInCalendarDays(startOfDay(today), startOfDay(end));
    return diff > 0 ? diff : 0;
}

/**
 * Avance de un conjunto de partidas hoja, ponderado por **monto**.
 *
 * El panel las ponderaba por `quantity`, sumando cantidades de unidades
 * distintas: 35.000 m de cable, 950 m³ de hormigón y 450 ton de estructura
 * caían en la misma suma. El resultado no era un avance, era el promedio de una
 * suma sin sentido físico — y lo dominaba la partida con el número más grande,
 * no la más importante. En la obra de ejemplo daba 57% cuando el avance real
 * era 45%, porque los 35.000 m de cable pesaban más que toda la obra gruesa.
 *
 * Ponderar por monto (cantidad × precio unitario) es cómo se mide el avance
 * físico en obra, y es la misma base sobre la que se emite un estado de pago.
 *
 * Cuando ninguna partida tiene precio cargado —una obra recién creada— se cae a
 * la ponderación por cantidad, que al menos respeta el tamaño relativo dentro de
 * una misma unidad; y si tampoco hay cantidades, al promedio simple.
 */
export function rollupProgress(
    leaves: { quantity?: number | null; unitPrice?: number | null; progress?: number | null }[],
): number {
    if (leaves.length === 0) return 0;

    const value = (i: { quantity?: number | null; unitPrice?: number | null }) =>
        (i.quantity || 0) * (i.unitPrice || 0);

    const totalValue = leaves.reduce((s, i) => s + value(i), 0);
    if (totalValue > 0) {
        return (leaves.reduce((s, i) => s + (value(i) * (i.progress || 0)) / 100, 0) / totalValue) * 100;
    }

    const totalQty = leaves.reduce((s, i) => s + (i.quantity || 0), 0);
    if (totalQty > 0) {
        return (leaves.reduce((s, i) => s + ((i.quantity || 0) * (i.progress || 0)) / 100, 0) / totalQty) * 100;
    }

    return leaves.reduce((s, i) => s + (i.progress || 0), 0) / leaves.length;
}
