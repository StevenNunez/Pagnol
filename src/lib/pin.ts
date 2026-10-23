/**
 * PIN personal del trabajador para aceptar una entrega identificada con carnet.
 *
 * Lógica pura (sin Supabase ni Node): la comparten la ruta del servidor, la
 * pantalla y los tests. El hash vive aparte, en `pin-server.ts`.
 *
 * Con 4 dígitos hay sólo 10.000 combinaciones: lo que protege el PIN no es el
 * hash sino el BLOQUEO. Por eso las constantes de bloqueo están acá, a la vista,
 * y las usa también la función SQL `pin_register_failure` (si se cambian, hay
 * que cambiar las dos).
 */

export const PIN_LENGTH = 4;
/** Fallos seguidos que bloquean al trabajador. */
export const PIN_MAX_ATTEMPTS = 5;
/** Minutos de bloqueo tras agotar los intentos. */
export const PIN_LOCK_MINUTES = 15;

export type PinFormatError = 'length' | 'not_digits' | 'trivial';

const TRIVIAL = new Set([
    '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
    '1234', '4321', '0123', '3210', '1212', '2121', '1122', '2211', '1010', '2020',
    '0007', '1004', '2580', '0852',
]);

/** Valida el formato; devuelve el motivo del rechazo o null si está bien. */
export function pinFormatError(pin: string): PinFormatError | null {
    if (typeof pin !== 'string' || pin.length !== PIN_LENGTH) return 'length';
    if (!/^\d+$/.test(pin)) return 'not_digits';
    if (TRIVIAL.has(pin)) return 'trivial';
    return null;
}

export const PIN_FORMAT_MESSAGE: Record<PinFormatError, string> = {
    length: `El PIN son ${PIN_LENGTH} números.`,
    not_digits: 'El PIN sólo puede llevar números.',
    trivial: 'Ese PIN es muy fácil de adivinar (por ejemplo 0000 o 1234). Elige otro.',
};

/**
 * Estado de bloqueo de un trabajador a partir de lo que guarda la fila.
 * `lockedUntil` en el pasado = ya no está bloqueado.
 */
export function pinLockState(
    row: { failedAttempts: number; lockedUntil: Date | string | null } | null,
    now: Date = new Date(),
): { locked: boolean; minutesLeft: number; attemptsLeft: number } {
    if (!row) return { locked: false, minutesLeft: 0, attemptsLeft: PIN_MAX_ATTEMPTS };
    const until = row.lockedUntil ? new Date(row.lockedUntil) : null;
    if (until && until.getTime() > now.getTime()) {
        return { locked: true, minutesLeft: Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60000)), attemptsLeft: 0 };
    }
    // Un bloqueo ya vencido deja el contador en 0: se empieza de nuevo.
    const failed = until ? 0 : row.failedAttempts;
    return { locked: false, minutesLeft: 0, attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - failed) };
}
