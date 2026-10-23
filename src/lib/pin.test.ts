import { describe, it, expect } from 'vitest';
import { pinFormatError, pinLockState, PIN_MAX_ATTEMPTS } from './pin';

describe('pinFormatError', () => {
    it('acepta un PIN de 4 números no obvio', () => {
        expect(pinFormatError('4821')).toBeNull();
        expect(pinFormatError('0739')).toBeNull();
    });
    it('rechaza largo distinto de 4', () => {
        expect(pinFormatError('482')).toBe('length');
        expect(pinFormatError('48213')).toBe('length');
        expect(pinFormatError('')).toBe('length');
    });
    it('rechaza lo que no son números', () => {
        expect(pinFormatError('48a1')).toBe('not_digits');
        expect(pinFormatError('4 21')).toBe('not_digits');
    });
    it('rechaza los PIN obvios', () => {
        for (const p of ['0000', '1111', '1234', '4321', '9999']) expect(pinFormatError(p)).toBe('trivial');
    });
    it('no revienta con algo que no es texto', () => {
        expect(pinFormatError(undefined as unknown as string)).toBe('length');
        expect(pinFormatError(1234 as unknown as string)).toBe('length');
    });
});

describe('pinLockState', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    it('sin fila: no bloqueado y con todos los intentos', () => {
        expect(pinLockState(null, now)).toEqual({ locked: false, minutesLeft: 0, attemptsLeft: PIN_MAX_ATTEMPTS });
    });
    it('descuenta los fallos', () => {
        expect(pinLockState({ failedAttempts: 2, lockedUntil: null }, now).attemptsLeft).toBe(PIN_MAX_ATTEMPTS - 2);
    });
    it('bloqueado hasta una hora futura, redondeando los minutos hacia arriba', () => {
        const r = pinLockState({ failedAttempts: 5, lockedUntil: '2026-10-22T12:10:30Z' }, now);
        expect(r).toEqual({ locked: true, minutesLeft: 11, attemptsLeft: 0 });
    });
    it('un bloqueo vencido empieza de cero', () => {
        const r = pinLockState({ failedAttempts: 5, lockedUntil: '2026-10-22T11:59:00Z' }, now);
        expect(r).toEqual({ locked: false, minutesLeft: 0, attemptsLeft: PIN_MAX_ATTEMPTS });
    });
    it('nunca devuelve intentos negativos', () => {
        expect(pinLockState({ failedAttempts: 99, lockedUntil: null }, now).attemptsLeft).toBe(0);
    });
});
