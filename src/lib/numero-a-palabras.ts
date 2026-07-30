// Monto en palabras para la liquidación de sueldo.
//
// Las liquidaciones reales lo llevan ("Son: UN MILLON SESENTA Y OCHO MIL
// SETECIENTOS TREINTA Y TRES 00/100 Pesos") y no es decorativo: es lo que hace
// que el documento no se pueda alterar cambiando un dígito. Por eso va con tests
// en vez de armarse a mano en el generador del PDF.
//
// Solo CLP y solo enteros: el peso no tiene centavos y la liquidación redondea.

const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
const ESPECIALES: Record<number, string> = {
    10: 'DIEZ', 11: 'ONCE', 12: 'DOCE', 13: 'TRECE', 14: 'CATORCE', 15: 'QUINCE',
    16: 'DIECISEIS', 17: 'DIECISIETE', 18: 'DIECIOCHO', 19: 'DIECINUEVE',
    20: 'VEINTE', 21: 'VEINTIUN', 22: 'VEINTIDOS', 23: 'VEINTITRES', 24: 'VEINTICUATRO',
    25: 'VEINTICINCO', 26: 'VEINTISEIS', 27: 'VEINTISIETE', 28: 'VEINTIOCHO', 29: 'VEINTINUEVE',
};
const DECENAS = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS',
    'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

/** 0–999 en palabras. */
function tramo(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const partes: string[] = [];
    if (c) partes.push(CENTENAS[c]);
    if (resto) {
        if (ESPECIALES[resto]) partes.push(ESPECIALES[resto]);
        else {
            const d = Math.floor(resto / 10);
            const u = resto % 10;
            // Unidad sola (resto < 10): sin decena no hay "Y" que agregar. Los
            // 10-29 ya salieron por ESPECIALES, así que acá d ≥ 3 o d === 0.
            if (d === 0) partes.push(UNIDADES[u]);
            else partes.push(u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d]);
        }
    }
    return partes.join(' ');
}

/**
 * Monto entero en palabras, en mayúsculas, como lo imprime una liquidación.
 * No incluye la palabra "Pesos" ni el sufijo de centavos: eso lo agrega el
 * formato del documento (`montoEnPalabrasCLP`).
 */
export function numeroAPalabras(n: number): string {
    const entero = Math.abs(Math.round(Number(n) || 0));
    if (entero === 0) return 'CERO';

    const millones = Math.floor(entero / 1_000_000);
    const miles = Math.floor((entero % 1_000_000) / 1000);
    const resto = entero % 1000;
    const partes: string[] = [];

    if (millones === 1) partes.push('UN MILLON');
    else if (millones > 1) partes.push(`${tramo(millones)} MILLONES`);

    if (miles === 1) partes.push('MIL');
    else if (miles > 1) partes.push(`${tramo(miles)} MIL`);

    if (resto) partes.push(tramo(resto));

    const texto = partes.join(' ').replace(/\s+/g, ' ').trim();
    return Number(n) < 0 ? `MENOS ${texto}` : texto;
}

/**
 * Formato exacto de la liquidación: `UN MILLON … 00/100 Pesos`.
 * Los centavos van siempre en 00 porque el peso chileno no los usa y el cálculo
 * redondea a peso.
 */
export function montoEnPalabrasCLP(n: number): string {
    return `${numeroAPalabras(n)} 00/100 Pesos`;
}
