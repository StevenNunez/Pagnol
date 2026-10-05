import { ApiError } from './errors';

// Paginación por cursor sobre (updated_at, id), el mismo orden que usa
// `updated_since`. El cursor guarda el `updated_at` TAL COMO lo devuelve
// Postgres (microsegundos): pasarlo por `Date` lo truncaría a milisegundos y
// dos filas del mismo milisegundo se saltarían o repetirían entre páginas.

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface Cursor {
    u: string; // updated_at crudo de la última fila entregada
    id: string;
}

export function encodeCursor(c: Cursor): string {
    return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

const TS_RE = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string): Cursor {
    try {
        const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
        // Se valida el contenido porque termina interpolado en un filtro de PostgREST.
        if (typeof c?.u === 'string' && TS_RE.test(c.u) && typeof c?.id === 'string' && UUID_RE.test(c.id)) {
            return { u: c.u, id: c.id };
        }
    } catch {
        /* cae al error de abajo */
    }
    throw new ApiError('validation_error', 'El parámetro `cursor` no es válido.', { param: 'cursor' });
}

/** Filtro PostgREST `or` para "después del cursor" en orden (updated_at, id). */
export function afterCursorFilter(c: Cursor): string {
    return `updated_at.gt."${c.u}",and(updated_at.eq."${c.u}",id.gt.${c.id})`;
}

/**
 * Corta la página: se piden `limit + 1` filas; si llegó la extra, hay más y el
 * cursor apunta a la última fila entregada.
 */
export function paginate<R extends { id: string; updated_at: string }>(
    rows: R[],
    limit: number,
): { page: R[]; next_cursor: string | null } {
    if (rows.length <= limit) return { page: rows, next_cursor: null };
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { page, next_cursor: encodeCursor({ u: last.updated_at, id: last.id }) };
}
