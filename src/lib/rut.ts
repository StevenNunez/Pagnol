/**
 * RUT chileno: limpieza, formato y dígito verificador (módulo 11).
 * La base tiene el mismo cálculo en `public.rut_is_valid()` (migración RFC-006 F3).
 */

/** Deja sólo números y la K final, en mayúscula: "76.412.380-5" → "764123805". */
export function cleanRut(rut: string): string {
    return (rut || '').toUpperCase().replace(/[^0-9K]/g, '');
}

/** Dígito verificador de un cuerpo numérico. */
export function rutCheckDigit(body: string): string {
    let sum = 0;
    let mul = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += Number(body[i]) * mul;
        mul = mul === 7 ? 2 : mul + 1;
    }
    const r = 11 - (sum % 11);
    return r === 11 ? '0' : r === 10 ? 'K' : String(r);
}

export function isValidRut(rut: string): boolean {
    const c = cleanRut(rut);
    if (c.length < 2) return false;
    const body = c.slice(0, -1);
    const dv = c.slice(-1);
    if (!/^\d+$/.test(body) || body.length < 6) return false;
    return rutCheckDigit(body) === dv;
}

/** "764123805" → "76.412.380-5". Si no se puede, devuelve lo recibido. */
export function formatRut(rut: string): string {
    const c = cleanRut(rut);
    if (c.length < 2) return rut;
    const body = c.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${body}-${c.slice(-1)}`;
}
