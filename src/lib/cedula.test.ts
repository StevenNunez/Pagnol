import { describe, it, expect } from 'vitest';
import { parseIdDocument, normalizeRun, findWorkerByRun } from './cedula';
import { rutCheckDigit } from './rut';

// RUN sintéticos con dígito verificador correcto (no son de nadie).
const A = '12345678';  const A_DV = rutCheckDigit(A);
const B = '9876543';   const B_DV = rutCheckDigit(B);
const K = '10000013';  // se busca uno cuyo DV sea K más abajo

describe('parseIdDocument — cédula nueva (QR con URL)', () => {
    it('saca el RUN del parámetro y descarta serie y MRZ', () => {
        const url = `https://portal.sidiv.registrocivil.cl/docstatus?RUN=${A}-${A_DV}&type=CEDULA&serial=A123456789&mrz=A12345678912345678`;
        expect(parseIdDocument(url)).toEqual({ run: `${A}-${A_DV}`, source: 'url' });
    });
    it('acepta el RUN con puntos y el parámetro en cualquier posición', () => {
        const url = `https://portal.sidiv.registrocivil.cl/docstatus?type=CEDULA&RUN=12.345.678-${A_DV}&serial=X`;
        expect(parseIdDocument(url)?.run).toBe(`${A}-${A_DV}`);
    });
    it('un RUN con dígito verificador malo no se acepta', () => {
        const mal = A_DV === '0' ? '1' : '0';
        expect(parseIdDocument(`https://x.cl/docstatus?RUN=${A}-${mal}&type=CEDULA`)).toBeNull();
    });
});

describe('parseIdDocument — cédula antigua (PDF417) y texto', () => {
    it('texto que empieza con el RUN con guion', () => {
        expect(parseIdDocument(`${A}-${A_DV}ABC123456789<<datos`)?.run).toBe(`${A}-${A_DV}`);
    });
    it('RUN pegado al resto, sin guion: el dígito verificador decide el largo del cuerpo', () => {
        expect(parseIdDocument(`${A}${A_DV}A123456789`)?.run).toBe(`${A}-${A_DV}`);
        expect(parseIdDocument(`${B}${B_DV}A123456789`)?.run).toBe(`${B}-${B_DV}`);
    });
    it('RUT escrito o pistoleado, con o sin formato', () => {
        expect(parseIdDocument(`12.345.678-${A_DV}`)).toEqual({ run: `${A}-${A_DV}`, source: 'text' });
        expect(parseIdDocument(`${A}${A_DV}`)?.run).toBe(`${A}-${A_DV}`);
        expect(parseIdDocument(`  ${A}-${A_DV}\n`)?.run).toBe(`${A}-${A_DV}`);
    });
    it('reconoce el DV K', () => {
        let body = '';
        for (let n = 5_000_000; n < 5_000_200; n++) if (rutCheckDigit(String(n)) === 'K') { body = String(n); break; }
        expect(body).not.toBe('');
        expect(parseIdDocument(`${body}-k`)?.run).toBe(`${body}-K`);
    });
    it('basura, vacío y números sueltos no son un RUN', () => {
        for (const x of ['', '   ', 'hola', '123', '99999999999999', 'https://google.com', K]) {
            expect(parseIdDocument(x)).toBeNull();
        }
    });
});

describe('findWorkerByRun', () => {
    const run = `${A}-${A_DV}`;
    const u = (id: string, rut: string, over = {}) => ({ id, rut, ...over });

    it('encuentra a la persona sin importar cómo esté escrito el RUT en la ficha', () => {
        const r = findWorkerByRun([u('1', `12.345.678-${A_DV}`), u('2', '1-9')], run);
        expect(r).toMatchObject({ kind: 'found', user: { id: '1' } });
    });
    it('sin coincidencia', () => {
        expect(findWorkerByRun([u('2', '1-9')], run).kind).toBe('none');
    });
    it('dos fichas con el mismo RUT: no elige', () => {
        const r = findWorkerByRun([u('1', `${A}${A_DV}`), u('2', `12.345.678-${A_DV}`)], run);
        expect(r.kind).toBe('ambiguous');
    });
    it('un desvinculado se reconoce pero no avanza; si hay otra ficha activa, gana esa', () => {
        expect(findWorkerByRun([u('1', run, { employmentStatus: 'terminated' })], run).kind).toBe('separated');
        const r = findWorkerByRun([u('1', run, { employmentStatus: 'terminated' }), u('2', run)], run);
        expect(r).toMatchObject({ kind: 'found', user: { id: '2' } });
    });
    it('normalizeRun', () => {
        expect(normalizeRun('12.345.678-k')).toBe('12345678-K');
        expect(normalizeRun('')).toBeNull();
        expect(normalizeRun(null)).toBeNull();
    });
});

// La pistola es un teclado: con la distribución equivocada el guion llega como `'` y el resto de
// los símbolos de una URL cambian de lugar. El dígito verificador sigue mandando: una lectura
// estropeada nunca puede apuntar a otra persona.
describe('parseIdDocument — pistola con otra distribución de teclado', () => {
    const run = `${A}-${A_DV}`;
    it('el RUT con el guion cambiado por otro símbolo', () => {
        expect(parseIdDocument(`${A}'${A_DV}`)?.run).toBe(run);
        expect(parseIdDocument(`12.345.678_${A_DV}`)?.run).toBe(run);
    });
    it('el PDF417 antiguo con el guion cambiado', () => {
        expect(parseIdDocument(`${A}'${A_DV} ABC123 DEMO`)?.run).toBe(run);
    });
    it('la URL del QR nuevo con `RUN=` y `-` estropeados', () => {
        expect(parseIdDocument(`https:--portal.sidiv.registrocivil.cl-docstatus_RUN)${A}'${A_DV}&type)CEDULA`)?.run).toBe(run);
    });
    it('con el dígito verificador malo sigue rechazando', () => {
        const mal = A_DV === '0' ? '1' : '0';
        expect(parseIdDocument(`${A}'${mal}`)).toBeNull();
        expect(parseIdDocument(`https:--x.cl-docstatus_RUN)${A}'${mal}&type)CEDULA`)).toBeNull();
    });
    it('un número cualquiera con un símbolo en medio no pasa por RUN', () => {
        expect(parseIdDocument('123456789012')).toBeNull();
        expect(parseIdDocument("1234'56789012")).toBeNull();
    });
});
