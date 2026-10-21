import { useSyncExternalStore } from "react";

/**
 * Salud de la carga de datos: qué colecciones fallaron, si la conexión en vivo
 * (Realtime) está caída y si la carga se dio por vencida. Es un almacén externo
 * mínimo (no un context) porque lo escriben 30+ hooks y lo lee sólo la UI que
 * avisa; así no re-renderiza el árbol de datos.
 */
export interface DataHealth {
    /** Colecciones cuya última carga falló (se muestra lo último bueno, o nada). */
    failed: readonly string[];
    /** Colecciones cuyo canal Realtime está caído. */
    realtimeDown: readonly string[];
    /** La carga inicial lleva más de lo normal. */
    slow: boolean;
    /** Se dejó de esperar: la UI no debe afirmar "vacío" sin calificar. */
    gaveUp: boolean;
    /** Sube con cada petición de resincronización; los hooks refetchean al verlo. */
    retryTick: number;
}

const initial: DataHealth = { failed: [], realtimeDown: [], slow: false, gaveUp: false, retryTick: 0 };

let state: DataHealth = initial;
const listeners = new Set<() => void>();
let lastResync = 0;

/** Mínimo entre resincronizaciones automáticas, para no martillar la base. */
export const RESYNC_THROTTLE_MS = 15_000;

function set(next: DataHealth) {
    if (next === state) return;
    state = next;
    listeners.forEach(l => l());
}

const add = (list: readonly string[], v: string) => (list.includes(v) ? list : [...list, v]);
const drop = (list: readonly string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : list);

export function markFailed(table: string) {
    const failed = add(state.failed, table);
    if (failed !== state.failed) set({ ...state, failed });
}

export function markOk(table: string) {
    const failed = drop(state.failed, table);
    if (failed !== state.failed) set({ ...state, failed });
}

export function setRealtime(table: string, up: boolean) {
    const realtimeDown = up ? drop(state.realtimeDown, table) : add(state.realtimeDown, table);
    if (realtimeDown !== state.realtimeDown) set({ ...state, realtimeDown });
}

export function setSlow(slow: boolean) {
    if (state.slow !== slow) set({ ...state, slow });
}

export function setGaveUp(gaveUp: boolean) {
    if (state.gaveUp !== gaveUp) set({ ...state, gaveUp });
}

/**
 * Pide que todas las colecciones se vuelvan a leer. Las automáticas (volvió la
 * señal, se reactivó la pestaña) van con límite de frecuencia; el botón
 * «Reintentar» pasa `force` y siempre actúa.
 */
export function requestResync(force = false, now = Date.now()): boolean {
    if (!force && now - lastResync < RESYNC_THROTTLE_MS) return false;
    lastResync = now;
    set({ ...state, retryTick: state.retryTick + 1, gaveUp: force ? false : state.gaveUp });
    return true;
}

export function getDataHealth(): DataHealth {
    return state;
}

/** Sólo para tests. */
export function resetDataHealth() {
    state = initial;
    lastResync = 0;
    listeners.forEach(l => l());
}

function subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
}

export function useDataHealth(): DataHealth {
    return useSyncExternalStore(subscribe, getDataHealth, () => initial);
}

/** Pasos de espera entre reintentos automáticos de una carga fallida (ms). */
export const RETRY_BACKOFF_MS = [3_000, 8_000, 20_000, 45_000] as const;

export function backoffFor(attempt: number): number | null {
    return attempt < RETRY_BACKOFF_MS.length ? RETRY_BACKOFF_MS[attempt] : null;
}

/** Pausa mínima oculta antes de que volver a la pestaña dispare una resincronización. */
export const HIDDEN_RESYNC_AFTER_MS = 30_000;

/** Sólo el contador: los hooks de colección no deben re-renderizar por otros cambios de salud. */
export function useRetryTick(): number {
    return useSyncExternalStore(subscribe, () => state.retryTick, () => 0);
}
