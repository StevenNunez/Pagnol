import { describe, it, expect } from 'vitest';
import {
    summarizeReview, indexReviews, canReviewRequest, reviewerIdsFor, resolveObservations,
    reviewDueState, regularizationState, pendingMaterialIds, isOversightRole,
    type ReviewableRequest, type Observation, type ReturnFact,
} from './withdrawalReviewMath';

const req = (over: Partial<ReviewableRequest> = {}): ReviewableRequest => ({
    id: 'r1',
    requiresReview: true,
    contractId: 'c1',
    supervisorId: 'worker',
    items: [{ materialId: 'm1', quantity: 2 }, { materialId: 'm2', quantity: 1 }, { materialId: 'm3', quantity: 1 }],
    ...over,
});

describe('summarizeReview', () => {
    it('sin hechos: todo pendiente', () => {
        const s = summarizeReview(req());
        expect(s.state).toBe('pending');
        expect(s.pendingLines).toBe(3);
        expect(s.unauthorizedLines).toBe(0);
    });

    it('algunas líneas revisadas: parcial', () => {
        const s = summarizeReview(req(), [
            { requestId: 'r1', materialId: 'm1', decision: 'authorized' },
            { requestId: 'r1', materialId: 'm2', decision: 'unauthorized' },
        ]);
        expect(s.state).toBe('partial');
        expect(s.pendingLines).toBe(1);
        expect(s.unauthorizedLines).toBe(1);
    });

    it('todas revisadas: revisado, contando las no autorizadas', () => {
        const s = summarizeReview(req(), [
            { requestId: 'r1', materialId: 'm1', decision: 'authorized' },
            { requestId: 'r1', materialId: 'm2', decision: 'unauthorized' },
            { requestId: 'r1', materialId: 'm3', decision: 'unauthorized' },
        ]);
        expect(s.state).toBe('reviewed');
        expect(s.unauthorizedLines).toBe(2);
        expect(s.decisions.get('m1')).toBe('authorized');
    });

    it('un material repetido en el JSON se revisa una sola vez', () => {
        const s = summarizeReview(req({ items: [{ materialId: 'm1', quantity: 1 }, { materialId: 'm1', quantity: 3 }] }), [
            { requestId: 'r1', materialId: 'm1', decision: 'authorized' },
        ]);
        expect(s.state).toBe('reviewed');
    });

    it('la primera decisión de una línea es la que vale', () => {
        const s = summarizeReview(req(), [
            { requestId: 'r1', materialId: 'm1', decision: 'unauthorized' },
            { requestId: 'r1', materialId: 'm1', decision: 'authorized' },
        ]);
        expect(s.decisions.get('m1')).toBe('unauthorized');
    });
});

describe('indexReviews', () => {
    it('agrupa por retiro', () => {
        const idx = indexReviews([
            { requestId: 'a', materialId: 'm1', decision: 'authorized' as const },
            { requestId: 'b', materialId: 'm1', decision: 'authorized' as const },
            { requestId: 'a', materialId: 'm2', decision: 'unauthorized' as const },
        ]);
        expect(idx.get('a')).toHaveLength(2);
        expect(idx.get('b')).toHaveLength(1);
        expect(idx.get('c')).toBeUndefined();
    });
});

describe('canReviewRequest', () => {
    const mine = new Set(['c1']);
    it('supervisor del contrato puede revisar', () => {
        expect(canReviewRequest(req(), { id: 'sup', seesAllContracts: false, contractIds: mine })).toBe(true);
    });
    it('supervisor de otro contrato no puede', () => {
        expect(canReviewRequest(req({ contractId: 'c2' }), { id: 'sup', seesAllContracts: false, contractIds: mine })).toBe(false);
    });
    it('retiro sin contrato: sólo quien ve todos', () => {
        expect(canReviewRequest(req({ contractId: null }), { id: 'sup', seesAllContracts: false, contractIds: mine })).toBe(false);
        expect(canReviewRequest(req({ contractId: null }), { id: 'adm', seesAllContracts: true, contractIds: new Set() })).toBe(true);
    });
    it('nadie revisa su propio retiro, ni siquiera administración', () => {
        expect(canReviewRequest(req({ supervisorId: 'adm' }), { id: 'adm', seesAllContracts: true, contractIds: mine })).toBe(false);
    });
    it('un retiro que no salió con revisión posterior no se revisa', () => {
        expect(canReviewRequest(req({ requiresReview: false }), { id: 'adm', seesAllContracts: true, contractIds: mine })).toBe(false);
    });
});

describe('reviewerIdsFor', () => {
    const users = [
        { id: 'sup1', role: 'supervisor' },
        { id: 'sup2', role: 'supervisor' },
        { id: 'adm1', role: 'administrador' },
        { id: 'adm2', role: 'administrador' },
        { id: 'op1', role: 'operador' },
    ];
    const cw = [
        { contractId: 'c1', userId: 'sup1' },
        { contractId: 'c1', userId: 'op1' },
        { contractId: 'c2', userId: 'sup2' },
    ];
    it('avisa a los supervisores del contrato', () => {
        expect(reviewerIdsFor('c1', 'op1', users, cw)).toEqual(['sup1']);
    });
    it('sin supervisor en el contrato: administradores', () => {
        expect(reviewerIdsFor('c9', 'op1', users, cw)).toEqual(['adm1', 'adm2']);
    });
    it('sin contrato: administradores', () => {
        expect(reviewerIdsFor(null, 'op1', users, cw)).toEqual(['adm1', 'adm2']);
    });
    it('si el único supervisor es quien retiró, va a administración (no queda vacío)', () => {
        expect(reviewerIdsFor('c1', 'sup1', users, cw)).toEqual(['adm1', 'adm2']);
    });
    it('un administrador que retira no se avisa a sí mismo', () => {
        expect(reviewerIdsFor(null, 'adm1', users, cw)).toEqual(['adm2']);
    });
});


describe('resolveObservations', () => {
    const d = (day: number) => new Date(2026, 9, day, 10);
    const obs = (id: string, over: Partial<Observation> = {}): Observation => ({
        reviewId: id, requestId: 'r', workerId: 'w', materialId: 'm', quantity: 1, withdrawnAt: d(5), ...over,
    });
    const ret = (id: string, over: Partial<ReturnFact> = {}): ReturnFact => ({
        id, workerId: 'w', materialId: 'm', quantity: 1, status: 'completed', at: d(6), ...over,
    });

    it('sin devolución ni justificación: abierta', () => {
        expect(resolveObservations([obs('a')], [], new Set()).get('a')).toEqual({ status: 'open', returnedQty: 0 });
    });

    it('devuelta después del retiro: se cierra sola', () => {
        const s = resolveObservations([obs('a')], [ret('x', { internalCode: 'RET-1' })], new Set()).get('a')!;
        expect(s.status).toBe('returned');
        expect(s.closingReturn?.internalCode).toBe('RET-1');
    });

    it('una devolución ANTERIOR al retiro no la cierra', () => {
        expect(resolveObservations([obs('a')], [ret('x', { at: d(4) })], new Set()).get('a')!.status).toBe('open');
    });

    it('devolución pendiente o rechazada no cuenta', () => {
        const r = resolveObservations([obs('a')], [ret('x', { status: 'pending' }), ret('y', { status: 'rejected' })], new Set());
        expect(r.get('a')!.status).toBe('open');
    });

    it('otro trabajador u otro material no la cierran', () => {
        const r = resolveObservations([obs('a')], [ret('x', { workerId: 'otro' }), ret('y', { materialId: 'otro' })], new Set());
        expect(r.get('a')!.status).toBe('open');
    });

    it('devolución parcial: sigue abierta y dice cuánto volvió', () => {
        const s = resolveObservations([obs('a', { quantity: 3 })], [ret('x', { quantity: 2 })], new Set()).get('a')!;
        expect(s).toMatchObject({ status: 'open', returnedQty: 2 });
    });

    it('varias devoluciones suman', () => {
        const s = resolveObservations([obs('a', { quantity: 3 })], [ret('x', { quantity: 2 }), ret('y', { quantity: 1, at: d(7) })], new Set()).get('a')!;
        expect(s.status).toBe('returned');
        expect(s.closingReturn?.id).toBe('y');
    });

    it('una unidad devuelta no cierra dos observaciones: cubre la más antigua', () => {
        const r = resolveObservations([obs('nueva', { withdrawnAt: d(5) }), obs('vieja', { withdrawnAt: d(3) })], [ret('x')], new Set());
        expect(r.get('vieja')!.status).toBe('returned');
        expect(r.get('nueva')!.status).toBe('open');
    });

    it('la justificación manda aunque no haya devolución', () => {
        expect(resolveObservations([obs('a')], [], new Set(['a'])).get('a')!.status).toBe('justified');
    });

    it('una observación justificada no consume la devolución de otra', () => {
        const r = resolveObservations([obs('a', { withdrawnAt: d(3) }), obs('b')], [ret('x')], new Set(['a']));
        expect(r.get('a')!.status).toBe('justified');
        expect(r.get('b')!.status).toBe('returned');
    });
});

describe('supervisor responsable', () => {
    const me = (over = {}) => ({ id: 'sup1', seesAllContracts: false, contractIds: new Set(['c1']), ...over });

    it('con responsable: sólo él revisa, aunque otro supervisor comparta el contrato', () => {
        const r = req({ reviewerSupervisorId: 'sup1' });
        expect(canReviewRequest(r, me())).toBe(true);
        expect(canReviewRequest(r, me({ id: 'sup2' }))).toBe(false);
    });

    it('con responsable: ver todos los contratos NO basta, hace falta ser jefatura', () => {
        const r = req({ reviewerSupervisorId: 'sup1' });
        expect(canReviewRequest(r, me({ id: 'oficina', seesAllContracts: true }))).toBe(false);
        expect(canReviewRequest(r, me({ id: 'jo', seesAllContracts: true, oversight: true }))).toBe(true);
    });

    it('nadie revisa su propio retiro, ni siquiera la jefatura', () => {
        const r = req({ supervisorId: 'jo', reviewerSupervisorId: 'sup1' });
        expect(canReviewRequest(r, me({ id: 'jo', oversight: true }))).toBe(false);
    });

    it('sin responsable rige la regla del contrato', () => {
        expect(canReviewRequest(req(), me())).toBe(true);
        expect(canReviewRequest(req(), me({ contractIds: new Set(['otro']) }))).toBe(false);
    });

    it('el aviso va al responsable; si es quien retiró o no existe, cae al respaldo', () => {
        const users = [{ id: 'sup1', role: 'supervisor' }, { id: 'adm', role: 'administrador' }, { id: 'w', role: 'operador' }];
        expect(reviewerIdsFor('c1', 'w', users, [], 'sup1')).toEqual(['sup1']);
        expect(reviewerIdsFor('c1', 'sup1', users, [], 'sup1')).toEqual(['adm']);
        expect(reviewerIdsFor('c1', 'w', users, [], 'fantasma')).toEqual(['adm']);
    });

    it('isOversightRole', () => {
        expect(isOversightRole('jefe-operaciones')).toBe(true);
        expect(isOversightRole('supervisor')).toBe(false);
        expect(isOversightRole(undefined)).toBe(false);
    });
});

describe('plazo de revisión', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    it('no vence antes del plazo y vence justo en él', () => {
        expect(reviewDueState('2026-10-19T13:00:00Z', 24, now).overdue).toBe(false);
        expect(reviewDueState('2026-10-19T12:00:00Z', 24, now).overdue).toBe(true);
    });
    it('sin plazo configurado usa 48 horas', () => {
        expect(reviewDueState('2026-10-18T13:00:00Z', null, now).overdue).toBe(false);
        expect(reviewDueState('2026-10-18T11:00:00Z', undefined, now).deadlineHours).toBe(48);
    });
    it('fecha ilegible: nunca marca vencido', () => {
        expect(reviewDueState(undefined, 24, now).overdue).toBe(false);
        expect(reviewDueState('basura', 24, now).overdue).toBe(false);
    });
});

describe('regularización y líneas pendientes', () => {
    it('regularizationState', () => {
        expect(regularizationState([])).toBe('none');
        expect(regularizationState(['open', 'returned'])).toBe('pending');
        expect(regularizationState(['returned', 'justified'])).toBe('resolved');
    });
    it('pendingMaterialIds ignora lo ya decidido y no repite materiales', () => {
        const r = req({ items: [{ materialId: 'm1', quantity: 1 }, { materialId: 'm1', quantity: 1 }, { materialId: 'm2', quantity: 1 }] });
        expect(pendingMaterialIds(r, [{ requestId: 'r1', materialId: 'm2', decision: 'authorized' }])).toEqual(['m1']);
        expect(pendingMaterialIds(r)).toEqual(['m1', 'm2']);
    });
});
