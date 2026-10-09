import { describe, it, expect } from 'vitest';
import { cleanRut, isValidRut, formatRut, rutCheckDigit } from './rut';

describe('RUT', () => {
    it('limpia puntos, guion y espacios', () => {
        expect(cleanRut(' 76.412.380-8 ')).toBe('764123808');
        expect(cleanRut('10.000.013-k')).toBe('10000013K');
    });
    it('calcula el dígito verificador (incluye 0 y K)', () => {
        expect(rutCheckDigit('12345678')).toBe('5');
        expect(rutCheckDigit('76412380')).toBe('8');
        expect(rutCheckDigit('10000013')).toBe('K');
        expect(rutCheckDigit('10000004')).toBe('0');
    });
    it('valida', () => {
        expect(isValidRut('12.345.678-5')).toBe(true);
        expect(isValidRut('10.000.013-K')).toBe(true);
        expect(isValidRut('10000013k')).toBe(true);
        expect(isValidRut('10.000.004-0')).toBe(true);
        // Dígito equivocado: el error típico al tipear una factura.
        expect(isValidRut('76.412.380-5')).toBe(false);
        expect(isValidRut('13.456.789-K')).toBe(false);
        expect(isValidRut('1-9')).toBe(false); // cuerpo demasiado corto
        expect(isValidRut('')).toBe(false);
    });
    it('formatea', () => {
        expect(formatRut('764123808')).toBe('76.412.380-8');
        expect(formatRut('10000013k')).toBe('10.000.013-K');
    });
});
