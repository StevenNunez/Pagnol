import { describe, it, expect } from 'vitest';
import { exceptionStatus } from './biometricMath';

/**
 * El estado de una excepción biométrica NO se guarda: se deriva de sus hechos,
 * igual que el ledger financiero deriva el saldo de sus asientos. Si esta
 * derivación se equivoca, un activo puede salir del pañol sin autorización —o
 * quedar bloqueado teniéndola—, así que es la pieza que más merece pruebas.
 */

const h = (outcome: string, minutos: number) => ({
    outcome,
    createdAt: new Date(2026, 7, 11, 10, minutos),
});

describe('exceptionStatus', () => {
    it('sin resolución, queda pendiente', () => {
        expect(exceptionStatus([h('exception_requested', 0)])).toBe('pendiente');
    });

    it('una aprobación la deja aprobada', () => {
        expect(exceptionStatus([
            h('exception_requested', 0),
            h('exception_granted', 5),
        ])).toBe('aprobada');
    });

    it('un rechazo la deja rechazada', () => {
        expect(exceptionStatus([
            h('exception_requested', 0),
            h('exception_denied', 5),
        ])).toBe('rechazada');
    });

    it('gana la resolución MÁS RECIENTE, no el orden del arreglo', () => {
        // Append-only: un error se corrige agregando un hecho nuevo, nunca
        // reescribiendo el anterior. Si llegan desordenados (Realtime no
        // garantiza orden), igual debe ganar el último por fecha.
        expect(exceptionStatus([
            h('exception_granted', 5),
            h('exception_denied', 20),
            h('exception_requested', 0),
        ])).toBe('rechazada');

        expect(exceptionStatus([
            h('exception_denied', 5),
            h('exception_granted', 20),
        ])).toBe('aprobada');
    });

    it('ignora los hechos de verificación normales', () => {
        // Un intento fallido de cámara no resuelve nada: la excepción sigue
        // esperando a que una persona la apruebe.
        expect(exceptionStatus([
            h('exception_requested', 0),
            h('no_face', 2),
            h('no_match', 3),
            h('error', 4),
        ])).toBe('pendiente');
    });

    it('sin hechos, pendiente (nunca "aprobada" por omisión)', () => {
        // El fallo seguro es hacia el bloqueo: ante la duda, el activo no sale.
        expect(exceptionStatus([])).toBe('pendiente');
    });
});
