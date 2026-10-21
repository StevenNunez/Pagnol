/**
 * Lógica pura de la carga de una colección, separada del hook para poder
 * probarla sin Supabase ni React.
 */

export interface PageResult {
    data: any[] | null;
    error: { code?: string; message: string } | null;
}

export type FetchPage = (from: number, to: number, columns: string, signal: AbortSignal) => PromiseLike<PageResult>;

export type LoadOutcome =
    | { ok: true; rows: any[] }
    | { ok: false; error: string };

export const PAGE_SIZE = 1000;
/** Tope por petición: una conexión colgada no debe dejar la pantalla en «cargando». */
export const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Lee todas las páginas. Si CUALQUIERA falla devuelve error y NINGUNA fila: un
 * resultado parcial presentado como completo es peor que un error visible.
 */
export async function loadAllPages(
    fetchPage: FetchPage,
    opts: { columns: string; fallbackColumns?: string; timeoutMs?: number; onFallback?: (message: string) => void },
): Promise<LoadOutcome> {
    const { fallbackColumns, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
    let columnsInUse = opts.columns;
    let rows: any[] = [];
    let from = 0;

    for (;;) {
        const signal = AbortSignal.timeout(timeoutMs);
        let res: PageResult;
        try {
            res = await fetchPage(from, from + PAGE_SIZE - 1, columnsInUse, signal);
        } catch (e: any) {
            const timedOut = signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError';
            return { ok: false, error: timedOut ? 'tiempo de espera agotado' : String(e?.message ?? e) };
        }

        if (res.error?.code === '42703' && fallbackColumns && columnsInUse !== fallbackColumns) {
            opts.onFallback?.(res.error.message);
            columnsInUse = fallbackColumns;
            continue;
        }
        if (res.error) return { ok: false, error: res.error.message || res.error.code || 'error desconocido' };

        const batch = res.data ?? [];
        if (batch.length === 0) break;
        rows = rows.concat(batch);
        from += batch.length;
        if (batch.length < PAGE_SIZE) break;
    }
    return { ok: true, rows };
}

/**
 * Qué hacer con el resultado de una carga. Una carga fallida NUNCA pisa datos
 * buenos: si ya había datos se conservan; si no, queda vacío pero marcado como
 * fallido (la UI muestra el error, no «sin datos»).
 */
export function nextCollectionState<T>(
    prev: T[],
    outcome: LoadOutcome,
    mapper?: (row: any) => T,
): { data: T[]; failed: boolean } {
    if (!outcome.ok) return { data: prev, failed: true };
    return { data: (mapper ? outcome.rows.map(mapper) : outcome.rows) as T[], failed: false };
}
