import { describe, it, expect } from 'vitest';
import { resolveSigners, grossFromNet, resolveApprovalSettings, DEFAULT_APPROVAL_SETTINGS, deriveProposalState, pendingSlots, canSignSlot, canEmitWith, rentalMonthlyNet, withdrawalValueNet } from './approvalMath';

const torres = { id: 'c-torres', name: 'Torres', adcUserId: 'u-adc-torres' };
const puerto = { id: 'c-puerto', name: 'Puerto', adcUserId: 'u-adc-puerto' };
const sinAdc = { id: 'c-nuevo', name: 'Contrato nuevo', adcUserId: null };

describe('grossFromNet', () => {
    it('suma el IVA y redondea a peso', () => {
        expect(grossFromNet(100_000, 0.19)).toBe(119_000);
        expect(grossFromNet(420_169, 0.19)).toBe(500_001);
    });
    it('neto inválido o cero = 0', () => {
        expect(grossFromNet(0, 0.19)).toBe(0);
        expect(grossFromNet(-5, 0.19)).toBe(0);
        expect(grossFromNet(NaN, 0.19)).toBe(0);
    });
});

describe('resolveApprovalSettings', () => {
    it('sin configuración usa los valores de Valar', () => {
        expect(resolveApprovalSettings(null)).toEqual(DEFAULT_APPROVAL_SETTINGS);
        expect(DEFAULT_APPROVAL_SETTINGS).toEqual({ adcMaxGross: 500_000, vatRate: 0.19 });
    });
    it('descarta valores absurdos', () => {
        expect(resolveApprovalSettings({ adcMaxGross: -1, vatRate: 1.5 })).toEqual(DEFAULT_APPROVAL_SETTINGS);
    });
    it('respeta lo configurado', () => {
        expect(resolveApprovalSettings({ adcMaxGross: 1_000_000 })).toEqual({ adcMaxGross: 1_000_000, vatRate: 0.19 });
    });
});

describe('resolveSigners — tramos de Valar (hasta $500.000 con IVA el ADC)', () => {
    it('justo en el tope firma el ADC', () => {
        // 420.168 neto → 499.999,9 → 500.000 con IVA
        const r = resolveSigners({ net: 420_168, contracts: [torres] });
        expect(r.gross).toBe(500_000);
        expect(r.tier).toBe('adc');
        expect(r.signers).toEqual([{ kind: 'adc', contractId: 'c-torres', contractName: 'Torres', userId: 'u-adc-torres' }]);
        expect(r.ready).toBe(true);
    });

    it('un peso sobre el tope firma sólo el Gerente', () => {
        const r = resolveSigners({ net: 420_169, contracts: [torres, puerto] });
        expect(r.gross).toBe(500_001);
        expect(r.tier).toBe('gerente');
        expect(r.signers).toEqual([{ kind: 'gerente' }]);
        expect(r.ready).toBe(true);
    });

    it('el tramo se mide con IVA, no neto', () => {
        // 450.000 neto no pasa el tope en neto, pero con IVA son 535.500.
        expect(resolveSigners({ net: 450_000, contracts: [torres] }).tier).toBe('gerente');
    });

    it('varios contratos: firma el ADC de cada uno, sin repetir', () => {
        const r = resolveSigners({ net: 100_000, contracts: [torres, puerto, torres] });
        expect(r.signers.map(s => (s.kind === 'adc' ? s.contractId : 'gg'))).toEqual(['c-torres', 'c-puerto']);
    });
});

describe('resolveSigners — escalar y bloqueos', () => {
    it('Abastecimiento puede subirla al Gerente', () => {
        const r = resolveSigners({ net: 100_000, contracts: [torres], escalate: true });
        expect(r.tier).toBe('gerente');
        expect(r.escalated).toBe(true);
        expect(r.signers).toEqual([{ kind: 'gerente' }]);
    });

    it('escalar algo que ya va al Gerente no lo marca como escalado', () => {
        const r = resolveSigners({ net: 1_000_000, contracts: [torres], escalate: true });
        expect(r.tier).toBe('gerente');
        expect(r.escalated).toBe(false);
    });

    it('un contrato sin ADC bloquea la propuesta (no cae a cualquier ADC)', () => {
        const r = resolveSigners({ net: 100_000, contracts: [torres, sinAdc] });
        expect(r.ready).toBe(false);
        expect(r.contractsWithoutAdc).toEqual([{ id: 'c-nuevo', name: 'Contrato nuevo' }]);
        expect(r.signers).toHaveLength(1);
    });

    it('sin contrato tampoco se puede pedir la firma del ADC', () => {
        expect(resolveSigners({ net: 100_000, contracts: [] }).ready).toBe(false);
    });

    it('sobre el tope, un contrato sin ADC no bloquea: firma el Gerente', () => {
        const r = resolveSigners({ net: 2_000_000, contracts: [sinAdc] });
        expect(r.ready).toBe(true);
        expect(r.contractsWithoutAdc).toEqual([]);
    });

    it('respeta un tramo configurado por la empresa', () => {
        const r = resolveSigners({ net: 700_000, contracts: [torres], settings: { adcMaxGross: 1_000_000 } });
        expect(r.gross).toBe(833_000);
        expect(r.tier).toBe('adc');
    });
});


describe('deriveProposalState — espejo de approval_proposal_state()', () => {
    const adcSlots = [
        { kind: 'adc' as const, contractId: 'c1', contractName: 'Torres', userId: 'u1' },
        { kind: 'adc' as const, contractId: 'c2', contractName: 'Puerto', userId: 'u2' },
    ];
    const p = { id: 'p1', withdrawnAt: null, requiredSigners: adcSlots };
    const sig = (slotKind: 'adc' | 'gerente', contractId: string | null, decision: 'approved' | 'rejected', proposalId = 'p1') =>
        ({ proposalId, slotKind, contractId, decision });

    it('sin firmas está pendiente', () => {
        expect(deriveProposalState(p, [])).toBe('pending');
    });
    it('con un solo ADC de dos sigue pendiente', () => {
        expect(deriveProposalState(p, [sig('adc', 'c1', 'approved')])).toBe('pending');
        expect(pendingSlots(p, [sig('adc', 'c1', 'approved')]).map(s => (s as any).contractId)).toEqual(['c2']);
    });
    it('firmada cuando firman todos los puestos', () => {
        expect(deriveProposalState(p, [sig('adc', 'c1', 'approved'), sig('adc', 'c2', 'approved')])).toBe('approved');
    });
    it('un rechazo basta para rechazarla', () => {
        expect(deriveProposalState(p, [sig('adc', 'c1', 'approved'), sig('adc', 'c2', 'rejected')])).toBe('rejected');
    });
    it('las firmas de otra propuesta no cuentan', () => {
        expect(deriveProposalState(p, [sig('adc', 'c1', 'approved', 'otra'), sig('adc', 'c2', 'approved', 'otra')])).toBe('pending');
    });
    it('retirada gana sobre todo', () => {
        expect(deriveProposalState({ ...p, withdrawnAt: '2026-10-10' }, [sig('adc', 'c1', 'approved'), sig('adc', 'c2', 'approved')])).toBe('withdrawn');
    });
    it('sin puestos de firma nunca queda firmada sola', () => {
        expect(deriveProposalState({ ...p, requiredSigners: [] }, [])).toBe('pending');
    });
    it('el puesto del Gerente no depende del contrato', () => {
        const g = { id: 'p1', withdrawnAt: null, requiredSigners: [{ kind: 'gerente' as const }] };
        expect(deriveProposalState(g, [sig('gerente', null, 'approved')])).toBe('approved');
    });
});

describe('canSignSlot — espejo del trigger de firmas', () => {
    const slot = { kind: 'adc' as const, contractId: 'c1', contractName: 'Torres', userId: 'u1' };
    it('el ADC asignado firma su contrato, otro ADC no', () => {
        expect(canSignSlot({ id: 'u1', role: 'adc' }, slot)).toBe(true);
        expect(canSignSlot({ id: 'u9', role: 'adc' }, slot)).toBe(false);
    });
    it('el Gerente firma su puesto, no el del ADC', () => {
        expect(canSignSlot({ id: 'g', role: 'gerente-general' }, { kind: 'gerente' })).toBe(true);
        expect(canSignSlot({ id: 'g', role: 'gerente-general' }, slot)).toBe(false);
        expect(canSignSlot({ id: 'u1', role: 'adc' }, { kind: 'gerente' })).toBe(false);
    });
    it('administración puede firmar cualquier puesto', () => {
        expect(canSignSlot({ id: 'a', role: 'administrador' }, slot)).toBe(true);
        expect(canSignSlot({ id: 'a', role: 'administrador' }, { kind: 'gerente' })).toBe(true);
    });
});

describe('canEmitWith — espejo del trigger de la OC (F3 urgencias)', () => {
    it('firmada: se emite', () => {
        expect(canEmitWith('approved', false)).toBe(true);
    });
    it('pendiente: sólo si es urgente', () => {
        expect(canEmitWith('pending', false)).toBe(false);
        expect(canEmitWith('pending', true)).toBe(true);
    });
    it('rechazada o retirada: nunca, aunque sea urgente', () => {
        expect(canEmitWith('rejected', true)).toBe(false);
        expect(canEmitWith('withdrawn', true)).toBe(false);
    });
});

describe('rentalMonthlyNet — espejo de public.rental_monthly_net() (F4)', () => {
    it('mensual: el precio del mes', () => {
        expect(rentalMonthlyNet(400_000, 'monthly', 1_200_000)).toBe(400_000);
    });
    it('diario, semanal y quincenal se llevan a un mes', () => {
        expect(rentalMonthlyNet(20_000, 'daily', null)).toBe(600_000);
        expect(rentalMonthlyNet(100_000, 'weekly', 0)).toBe(400_000);
        expect(rentalMonthlyNet(150_000, 'biweekly', null)).toBe(300_000);
    });
    it('si dura menos de un mes, se firma el total', () => {
        // 5 días a $20.000 = $100.000 (no $600.000)
        expect(rentalMonthlyNet(20_000, 'daily', 100_000)).toBe(100_000);
    });
    it('pago único: el precio completo', () => {
        expect(rentalMonthlyNet(850_000, 'one_time', 850_000)).toBe(850_000);
    });
    it('sin ciclo se asume mensual', () => {
        expect(rentalMonthlyNet(300_000, undefined, undefined)).toBe(300_000);
    });
});

describe('withdrawalValueNet — espejo de public.withdrawal_value_net() (F5)', () => {
    const costs = new Map<string, number | null>([['casco', 12_500], ['arnes', 89_000], ['sin-costo', null]]);
    it('suma cantidad × costo registrado', () => {
        expect(withdrawalValueNet([{ materialId: 'casco', quantity: 4 }, { materialId: 'arnes', quantity: 2 }], costs)).toBe(228_000);
    });
    it('un material sin costo registrado vale 0 (no rompe el cálculo)', () => {
        expect(withdrawalValueNet([{ materialId: 'sin-costo', quantity: 10 }, { materialId: 'otro', quantity: 1 }], costs)).toBe(0);
    });
    it('con IVA decide el tramo: $420.169 neto ya pasa el tope de Valar', () => {
        const net = withdrawalValueNet([{ materialId: 'x', quantity: 1 }], new Map([['x', 420_169]]));
        expect(resolveSigners({ net, contracts: [{ id: 'c', adcUserId: 'u' }] }).tier).toBe('gerente');
    });
});
