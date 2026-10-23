import 'server-only';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hash del PIN (sólo servidor). scrypt con sal por persona y un «pepper» que no
 * está en la base: quien se llevara la tabla `worker_pins` tampoco tendría con
 * qué probar las 10.000 combinaciones sin ese secreto.
 *
 * El pepper sale de `PIN_PEPPER`; si no existe se usa la llave de servicio de
 * Supabase (ya es un secreto sólo de servidor, y así no hace falta una variable
 * nueva para encender el PIN). Ojo: rotar ese secreto invalida todos los PIN y
 * obliga a que cada trabajador cree uno nuevo.
 */
function pepper(): string {
    const p = process.env.PIN_PEPPER || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!p) throw new Error('Falta PIN_PEPPER (o SUPABASE_SERVICE_ROLE_KEY) para proteger los PIN.');
    return p;
}

export function newSalt(): string {
    return randomBytes(16).toString('hex');
}

export function hashPin(pin: string, salt: string): string {
    return scryptSync(`${pin}:${pepper()}`, salt, 32).toString('hex');
}

/** Comparación en tiempo constante. */
export function pinMatches(pin: string, salt: string, expectedHash: string): boolean {
    const a = Buffer.from(hashPin(pin, salt), 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
}
