import { cleanRut, isValidRut, rutCheckDigit } from '@/lib/rut';

/**
 * Cédula de identidad chilena: de lo que lee el lector a un RUT con el que buscar
 * al trabajador.
 *
 * Qué se guarda: NADA del carnet. De lo que se lee sólo sale el RUN, y sólo para
 * buscar a la persona en la empresa; el número de serie, el MRZ y cualquier otro
 * dato del documento se descartan aquí mismo. El carnet identifica, pero NO
 * autoriza: tras encontrar al trabajador, la entrega sigue pidiendo su rostro.
 *
 * Formatos que se reconocen (el lector puede ser la cámara o una pistola, que
 * escribe lo leído como si fuera un teclado):
 *   · cédula nueva → QR con una URL del Registro Civil que trae `RUN=12345678-9`;
 *   · cédula antigua → código PDF417 cuyo texto empieza con el RUN;
 *   · el RUT escrito a mano o pistoleado ("12.345.678-9", "123456789").
 * El dígito verificador SIEMPRE se valida: una lectura rota no puede apuntar a otra persona.
 */

export type IdSource = 'url' | 'barcode' | 'text';

export interface ParsedId {
    /** RUN normalizado, sin puntos y con guion: "12345678-9". */
    run: string;
    source: IdSource;
}

const toRun = (body: string, dv: string) => `${body}-${dv.toUpperCase()}`;

/** Un cuerpo de 7 u 8 dígitos más su DV, si el DV calza. */
function validRun(body: string, dv: string): string | null {
    return /^\d{7,8}$/.test(body) && /^[0-9Kk]$/.test(dv) && rutCheckDigit(body) === dv.toUpperCase()
        ? toRun(body, dv) : null;
}

export function parseIdDocument(raw: string | null | undefined): ParsedId | null {
    const text = (raw || '').trim();
    if (!text) return null;

    // 1) Cédula nueva: la URL del QR lleva el RUN como parámetro.
    const param = text.match(/[?&]RUN=([0-9.\-]+[0-9Kk])/i);
    if (param) {
        const c = cleanRut(param[1]);
        const run = validRun(c.slice(0, -1), c.slice(-1));
        return run ? { run, source: 'url' } : null;
    }

    // 2) Cédula antigua (PDF417): el texto empieza con el RUN, con o sin guion y con
    //    o sin puntos, y sigue con datos del documento que no nos interesan.
    const lead = text.match(/^(\d{1,2}(?:\.\d{3}){2}|\d{7,8})-?([0-9Kk])(?![0-9Kk]*$)/);
    if (lead) {
        const run = validRun(lead[1].replace(/\./g, ''), lead[2]);
        if (run) return { run, source: 'barcode' };
    }

    // 3) Sólo el RUT (escrito o pistoleado). Tiene que ser TODO el texto.
    if (isValidRut(text) && /^[0-9.\-]+[0-9Kk]$/.test(text)) {
        const c = cleanRut(text);
        const run = validRun(c.slice(0, -1), c.slice(-1));
        if (run) return { run, source: 'text' };
    }

    // 4) PDF417 sin separadores: "123456785" + resto. Se prueban las dos longitudes
    //    posibles del cuerpo y sólo vale la que el dígito verificador confirma. Tras el RUN
    //    tiene que venir una letra o `<`, nunca otro dígito: así una cadena numérica larga
    //    cualquiera no pasa por RUN (el dígito verificador solo acierta 1 de cada 11 al azar).
    const glued = text.match(/^(\d{8,9})[A-Za-z<]/);
    if (glued) {
        for (const len of [8, 7]) {
            const run = validRun(glued[1].slice(0, len), text[len] ?? '');
            if (run) return { run, source: 'barcode' };
        }
    }

    // 5) Pistola con otra distribución de teclado. La pistola envía pulsaciones y las traduce
    //    Windows con SU distribución: con un lector en teclado inglés el guion llega como `'` o
    //    `_`, y en una URL también `=`, `:` y `/` salen cambiados (`RUN)12345678'9`). Se acepta un
    //    símbolo cualquiera donde iría el guion, y hasta tres tras `RUN`. Sigue siendo seguro:
    //    el dígito verificador se valida igual, y lo leído sólo sirve para buscar una ficha.
    const SIM = '[^0-9A-Za-z]';
    const CUERPO = '(\\d{1,2}(?:[.,]\\d{3}){2}|\\d{7,8})';
    const enUrl = text.match(new RegExp(`RUN${SIM}{1,3}${CUERPO}${SIM}([0-9Kk])(?!\\d)`, 'i'));
    const alInicio = enUrl ? null : text.match(new RegExp(`^${CUERPO}${SIM}([0-9Kk])(?!\\d)`));
    const raro = enUrl ?? alInicio;
    if (raro) {
        const run = validRun(raro[1].replace(/[.,]/g, ''), raro[2]);
        if (run) return { run, source: enUrl ? 'url' : 'barcode' };
    }
    return null;
}

/**
 * ¿Lo leído trae símbolos donde un RUT o la URL del carnet no los llevan? Delata un lector con
 * el teclado en otro idioma (ver el paso 5 de `parseIdDocument`). Sirve para avisarle a quien
 * opera, en vez de dejarlo frente a un "no se pudo leer" sin explicación.
 */
export function parecePistolaMalConfigurada(raw: string | null | undefined): boolean {
    // El guion y el punto son normales en un RUT; `'`, `_`, `(`, `)` y `"` no. Sólo se consulta
    // cuando la lectura ya falló, así que un falso positivo apenas agrega un aviso.
    return /['_()"]/.test((raw || '').trim());
}

/** "12.345.678-9" → "12345678-9", para comparar el RUN leído con el de la ficha. */
export function normalizeRun(rut: string | null | undefined): string | null {
    const c = cleanRut(rut || '');
    if (c.length < 2) return null;
    return `${c.slice(0, -1)}-${c.slice(-1)}`;
}

export type RunLookup<U> =
    | { kind: 'found'; user: U }
    | { kind: 'ambiguous'; users: U[] }
    | { kind: 'separated'; user: U }
    | { kind: 'none' };

/**
 * Busca al trabajador por su RUN dentro de la empresa. Si hay dos fichas con el
 * mismo RUT NO se elige: se avisa, porque entregar a nombre de la persona
 * equivocada es peor que pedir el dato a mano. Un desvinculado se reconoce pero
 * no se deja avanzar (el pañolero necesita saber POR QUÉ no entra).
 */
export function findWorkerByRun<U extends { rut?: string | null; employmentStatus?: string | null }>(
    users: readonly U[],
    run: string,
): RunLookup<U> {
    const matches = users.filter(u => normalizeRun(u.rut) === run);
    if (matches.length === 0) return { kind: 'none' };
    const active = matches.filter(u => u.employmentStatus !== 'terminated');
    if (active.length === 1) return { kind: 'found', user: active[0] };
    if (active.length > 1) return { kind: 'ambiguous', users: active };
    return { kind: 'separated', user: matches[0] };
}
