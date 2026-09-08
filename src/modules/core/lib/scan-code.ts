/**
 * Lectura de códigos con pistola.
 *
 * POR QUÉ EXISTE: la pistola es un teclado. Envía la pulsación, no el carácter,
 * y quien traduce es Windows con SU distribución. Un lector configurado en
 * teclado inglés contra un Windows en español manda la tecla que en inglés es
 * `-` y en español sale como `'`, así que `VALAR-ACT-0017` llega como
 * `VALAR'ACT'0017` y no calza con nada. El operador ve "QR no válido" delante de
 * un fierro cuyo código está impecable.
 *
 * QUÉ SE HACE: comparar por lo que el código realmente identifica —sus letras y
 * sus dígitos— e ignorar los separadores, que son decorativos. Así entra
 * cualquier símbolo que la distribución equivocada ponga en su lugar, sin tener
 * que mantener una tabla de traducción por modelo de lector.
 *
 * ⚠️ Esto es una RED, no el arreglo: el lector mal configurado sigue estropeando
 * cualquier otro campo donde se pistolee. Por eso `pareceMalConfigurado` avisa.
 */

/** Sólo letras y dígitos, en mayúscula. `VALAR'ACT'0017` y `VALAR-ACT-0017` → `VALARACT0017`. */
export function normalizarCodigo(valor: string | null | undefined): string {
    return (valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * ¿El texto leído trae separadores que un código interno nunca lleva?
 *
 * Los códigos internos usan sólo letras, dígitos y guiones (ver `qrBmp.ts`: el
 * QR se graba en modo alfanumérico). Cualquier otro símbolo entre medio delata
 * una distribución de teclado equivocada en el lector.
 */
export function pareceMalConfigurado(leido: string): boolean {
    return /[^A-Za-z0-9\- ]/.test(leido);
}

export type ResultadoBusqueda<T> =
    | { tipo: 'exacto' | 'tolerado'; item: T }
    | { tipo: 'ambiguo'; candidatos: T[] }
    | { tipo: 'sin-resultado' };

/**
 * Busca un ítem por lo que entregó el lector.
 *
 * Primero exige coincidencia exacta y sólo si no la hay recurre a la comparación
 * tolerante. El orden importa: si empezara por la tolerante, un código con
 * separadores raros que SÍ existe tal cual podría resolverse contra otro.
 *
 * Cuando la vía tolerante deja más de un candidato **no elige**: entregar el
 * activo equivocado es peor que pedirle al operador que teclee el código. Hoy
 * no hay ningún par que colisione en los 5.550 activos de la base, pero eso
 * depende de los datos y los datos cambian.
 */
export function buscarPorCodigoEscaneado<T>(
    items: readonly T[],
    leido: string,
    campos: (item: T) => (string | null | undefined)[],
    idDe: (item: T) => string,
): ResultadoBusqueda<T> {
    const texto = leido.trim();
    if (!texto) return { tipo: 'sin-resultado' };

    const enMayuscula = texto.toUpperCase();
    const exacto = items.find(item =>
        campos(item).some(c => c != null && c !== '' && c.toUpperCase() === enMayuscula)
    );
    if (exacto) return { tipo: 'exacto', item: exacto };

    const buscado = normalizarCodigo(texto);
    // Un código sin letras ni dígitos normaliza a cadena vacía, y una comparación
    // contra "" calzaría con todos los ítems que tienen el campo vacío.
    if (!buscado) return { tipo: 'sin-resultado' };

    const candidatos = items.filter(item =>
        campos(item).some(c => c && normalizarCodigo(c) === buscado)
    );

    const unicos = new Map(candidatos.map(c => [idDe(c), c]));
    if (unicos.size === 1) return { tipo: 'tolerado', item: [...unicos.values()][0] };
    if (unicos.size > 1) return { tipo: 'ambiguo', candidatos: [...unicos.values()] };
    return { tipo: 'sin-resultado' };
}
