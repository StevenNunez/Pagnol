import { describe, it, expect } from 'vitest';
import { attendanceOf, indexSignatures, isPendingFor, pendingWorkerIds, type SignatureFact } from './daily-talk-attendance';

const talk = {
    id: 't1',
    asistentes: [
        { id: 'juan', name: 'Juan Pérez', rut: '1-9' },
        { id: 'pedro', name: 'Pedro Soto' },
        { id: 'carlos', name: 'Carlos Díaz' },
        { id: 'viejo', name: 'Firma anterior', signed: true, signedAt: '2026-09-01T10:00:00Z' },
    ],
};

const fact = (over: Partial<SignatureFact>): SignatureFact => ({
    talkId: 't1', workerId: 'juan', status: 'signed', method: 'face', signedAt: '2026-10-20T08:00:00Z', ...over,
});

describe('attendanceOf', () => {
    it('sin hechos: los nuevos pendientes, la firma anterior firmada', () => {
        const a = attendanceOf(talk);
        expect(a.total).toBe(4);
        expect(a.pending).toBe(3);
        expect(a.signed).toBe(1);
        expect(a.rows.find(r => r.id === 'viejo')).toMatchObject({ state: 'signed', method: 'legacy' });
    });

    it('firmado, ausente y pendiente conviven', () => {
        const a = attendanceOf(talk, [
            fact({ workerId: 'juan', method: 'own_session', acknowledged: true }),
            fact({ workerId: 'carlos', status: 'absent', method: null }),
        ]);
        expect(a.rows.find(r => r.id === 'juan')).toMatchObject({ state: 'signed', method: 'own_session', acknowledged: true });
        expect(a.rows.find(r => r.id === 'carlos')?.state).toBe('absent');
        expect(a.rows.find(r => r.id === 'pedro')?.state).toBe('pending');
        expect([a.signed, a.absent, a.pending]).toEqual([2, 1, 1]);
    });

    it('quien faltó y llegó tarde: la firma gana a la ausencia', () => {
        const a = attendanceOf(talk, [
            fact({ workerId: 'carlos', status: 'absent', method: null }),
            fact({ workerId: 'carlos', method: 'handwritten' }),
        ]);
        expect(a.rows.find(r => r.id === 'carlos')).toMatchObject({ state: 'signed', method: 'handwritten' });
    });

    it('asistir no es comprender: sin confirmación expresa no hay «acknowledged»', () => {
        const a = attendanceOf(talk, [fact({ workerId: 'juan' })]);
        expect(a.rows.find(r => r.id === 'juan')?.acknowledged).toBe(false);
    });

    it('ignora hechos de otra charla', () => {
        const a = attendanceOf(talk, [fact({ talkId: 'otra', workerId: 'pedro' })]);
        expect(a.rows.find(r => r.id === 'pedro')?.state).toBe('pending');
    });
});

describe('pendientes', () => {
    const facts = [fact({ workerId: 'juan' })];
    it('isPendingFor', () => {
        expect(isPendingFor(talk, facts, 'juan')).toBe(false);
        expect(isPendingFor(talk, facts, 'pedro')).toBe(true);
        expect(isPendingFor(talk, facts, 'viejo')).toBe(false);
        expect(isPendingFor(talk, facts, 'nadie')).toBe(false);
    });
    it('pendingWorkerIds excluye firmados y ausentes', () => {
        expect(pendingWorkerIds(talk, [...facts, fact({ workerId: 'pedro', status: 'absent', method: null })])).toEqual(['carlos']);
    });
    it('indexSignatures agrupa por charla', () => {
        const m = indexSignatures([fact({}), fact({ talkId: 't2' }), fact({ workerId: 'pedro' })]);
        expect(m.get('t1')).toHaveLength(2);
        expect(m.get('t2')).toHaveLength(1);
    });
});
