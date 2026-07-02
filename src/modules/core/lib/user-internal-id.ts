import type { User } from './data';

/** Prefijo canónico del ID interno de personal (firma Pagnol). */
export const USER_ID_PREFIX = 'PAG';

/**
 * Genera el siguiente ID interno de personal de forma robusta: parsea TODOS los IDs
 * existentes (tolera el formato viejo `PAG-EMP-####` y el nuevo `PAG-####`) y toma
 * el máximo + 1. Antes había dos generadores con formatos distintos:
 *   - personal/page.tsx → `PAG-####`
 *   - create-user-form  → `PAG-EMP-####` (además `length+1`, frágil ante borrados)
 * Ahora ambos usan esta única fuente.
 */
export function generateUserInternalId(users: Pick<User, 'internalId'>[] | null | undefined): string {
    const nums = (users || [])
        .map(u => u.internalId?.match(/PAG-(?:EMP-)?(\d+)/i)?.[1])
        .map(n => (n ? parseInt(n, 10) : NaN))
        .filter(n => !Number.isNaN(n));
    const max = nums.length > 0 ? Math.max(...nums) : 1000;
    return `${USER_ID_PREFIX}-${(max + 1).toString().padStart(4, '0')}`;
}
