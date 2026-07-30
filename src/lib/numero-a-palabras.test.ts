import { describe, it, expect } from 'vitest';
import { numeroAPalabras, montoEnPalabrasCLP } from './numero-a-palabras';

describe('numeroAPalabras', () => {
    it('reproduce los montos de las liquidaciones reales', () => {
        // Textuales de los documentos de ene/feb/mar 2026
        expect(numeroAPalabras(1068733)).toBe('UN MILLON SESENTA Y OCHO MIL SETECIENTOS TREINTA Y TRES');
        expect(numeroAPalabras(852804)).toBe('OCHOCIENTOS CINCUENTA Y DOS MIL OCHOCIENTOS CUATRO');
        // El emisor usa el apócope "UN", no "UNO": es lo correcto delante de
        // "Pesos" y es lo que dice el documento. El ancla es el papel.
        expect(numeroAPalabras(1086351)).toBe('UN MILLON OCHENTA Y SEIS MIL TRESCIENTOS CINCUENTA Y UN');
        expect(numeroAPalabras(1096351)).toBe('UN MILLON NOVENTA Y SEIS MIL TRESCIENTOS CINCUENTA Y UN');
    });

    it('cero', () => {
        expect(numeroAPalabras(0)).toBe('CERO');
    });

    it('unidades y especiales', () => {
        expect(numeroAPalabras(1)).toBe('UN');
        expect(numeroAPalabras(15)).toBe('QUINCE');
        expect(numeroAPalabras(21)).toBe('VEINTIUN');
        expect(numeroAPalabras(29)).toBe('VEINTINUEVE');
        expect(numeroAPalabras(30)).toBe('TREINTA');
        expect(numeroAPalabras(31)).toBe('TREINTA Y UN');
    });

    it('cien exacto vs ciento', () => {
        expect(numeroAPalabras(100)).toBe('CIEN');
        expect(numeroAPalabras(101)).toBe('CIENTO UN');
        expect(numeroAPalabras(115)).toBe('CIENTO QUINCE');
    });

    it('miles', () => {
        expect(numeroAPalabras(1000)).toBe('MIL');
        expect(numeroAPalabras(1001)).toBe('MIL UN');
        expect(numeroAPalabras(2000)).toBe('DOS MIL');
        expect(numeroAPalabras(21000)).toBe('VEINTIUN MIL');
        expect(numeroAPalabras(100000)).toBe('CIEN MIL');
    });

    it('millones', () => {
        expect(numeroAPalabras(1000000)).toBe('UN MILLON');
        expect(numeroAPalabras(2000000)).toBe('DOS MILLONES');
        expect(numeroAPalabras(1500000)).toBe('UN MILLON QUINIENTOS MIL');
    });

    it('redondea a peso: el CLP no tiene centavos', () => {
        expect(numeroAPalabras(1000.4)).toBe('MIL');
        expect(numeroAPalabras(999.6)).toBe('MIL');
    });

    it('un líquido negativo se dice, no se esconde', () => {
        expect(numeroAPalabras(-5000)).toBe('MENOS CINCO MIL');
    });

    it('no deja espacios dobles', () => {
        for (const n of [1000000, 2000000, 1000, 100000, 1086351]) {
            expect(numeroAPalabras(n)).not.toMatch(/\s{2}/);
            expect(numeroAPalabras(n)).toBe(numeroAPalabras(n).trim());
        }
    });
});

describe('montoEnPalabrasCLP', () => {
    it('usa el formato exacto de la liquidación real', () => {
        expect(montoEnPalabrasCLP(1068733))
            .toBe('UN MILLON SESENTA Y OCHO MIL SETECIENTOS TREINTA Y TRES 00/100 Pesos');
    });
});
