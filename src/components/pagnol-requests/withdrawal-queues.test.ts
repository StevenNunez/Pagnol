import { describe, it, expect } from 'vitest';
import { withdrawalStage, withdrawalQueues } from './withdrawal-queues';
import { resolveSupervisorStage } from '@/components/supervisor-requests/request-pipeline';

// Un solo cálculo del estado de un retiro: la bandeja del pañol, la vista del solicitante y los reportes
// salen de él, así «dónde está mi retiro» no depende de qué pantalla se mire.
const R = (status: string, adc: string | null = null, delivery: string | null = null, id = 'x') =>
    ({ id, status, adcAuthorizedAt: adc, deliveryDate: delivery } as any);

describe('withdrawalStage', () => {
    it('pendiente sin ADC espera al ADC; con ADC espera al pañol', () => {
        expect(withdrawalStage(R('pending'))).toBe('waitingAdc');
        expect(withdrawalStage(R('pending', '2026-10-20'))).toBe('toApprove');
    });
    it('aprobado sin retirar está por entregar; con retiro, entregado', () => {
        expect(withdrawalStage(R('approved', '2026-10-20'))).toBe('toDeliver');
        expect(withdrawalStage(R('approved', '2026-10-20', '2026-10-21'))).toBe('delivered');
    });
    it('rechazado', () => {
        expect(withdrawalStage(R('rejected'))).toBe('rejected');
    });
    it('un estado desconocido no se asume «aprobado» (devuelve null)', () => {
        expect(withdrawalStage(R('cancelled'))).toBeNull();
        expect(withdrawalStage(R(''))).toBeNull();
    });
});

describe('withdrawalQueues', () => {
    it('reparte cada retiro en UNA cola y los desconocidos en ninguna', () => {
        const q = withdrawalQueues([
            R('pending', null, null, 'a'), R('pending', 't', null, 'b'), R('approved', 't', null, 'c'),
            R('approved', 't', 'd', 'e'), R('rejected', null, null, 'f'), R('weird', null, null, 'g'),
        ]);
        expect(q.waitingAdc.map(r => r.id)).toEqual(['a']);
        expect(q.toApprove.map(r => r.id)).toEqual(['b']);
        expect(q.toDeliver.map(r => r.id)).toEqual(['c']);
        expect(q.delivered.map(r => r.id)).toEqual(['e']);
        expect(q.rejected.map(r => r.id)).toEqual(['f']);
    });
    it('sin retiros', () => {
        expect(withdrawalQueues(undefined).toApprove).toEqual([]);
    });
});

describe('el solicitante ve el MISMO estado que el pañol', () => {
    it('cada estado del pañol tiene su nombre en la vista del solicitante', () => {
        const casos: [any, string][] = [
            [R('pending'), 'waiting_adc'], [R('pending', 't'), 'queued'], [R('approved', 't'), 'ready_pickup'],
            [R('approved', 't', 'd'), 'delivered'], [R('rejected'), 'rejected'],
        ];
        for (const [req, esperado] of casos) expect(resolveSupervisorStage(req)).toBe(esperado);
    });
});
