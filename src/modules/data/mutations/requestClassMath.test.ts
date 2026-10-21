import { describe, it, expect } from 'vitest';
import { asClass, highestClassOf, canApproveClass, permissionsToApprove } from './requestClassMath';
import { ROLES } from '@/modules/core/lib/permissions';

const canOf = (...perms: string[]) => (p: string) => perms.includes(p);

describe('highestClassOf — la clase sale de los materiales, nunca de quien pide', () => {
    it('toma la más exigente', () => {
        expect(highestClassOf(['C', 'B', 'C'])).toBe('B');
        expect(highestClassOf(['C', 'A', 'B'])).toBe('A');
        expect(highestClassOf(['C', 'C'])).toBe('C');
    });
    it('un material sin clase cuenta como C (no como A: ese era el defecto)', () => {
        expect(highestClassOf([null, undefined, ''])).toBe('C');
        expect(asClass('Z')).toBe('C');
        expect(asClass(undefined)).toBe('C');
    });
    it('sin ítems: C', () => {
        expect(highestClassOf([])).toBe('C');
    });
});

describe('canApproveClass', () => {
    it('A sólo con su permiso; B con B o A; C con cualquiera', () => {
        expect(canApproveClass(canOf('material_requests:approve_class_a'), 'A')).toBe(true);
        expect(canApproveClass(canOf('material_requests:approve_class_b'), 'A')).toBe(false);
        expect(canApproveClass(canOf('material_requests:approve_class_b'), 'B')).toBe(true);
        expect(canApproveClass(canOf('material_requests:approve_class_a'), 'B')).toBe(true);
        expect(canApproveClass(canOf('material_requests:approve_class_c'), 'B')).toBe(false);
        expect(canApproveClass(canOf('material_requests:approve_class_c'), 'C')).toBe(true);
        expect(canApproveClass(canOf(), 'C')).toBe(false);
    });
    it('permissionsToApprove es coherente con canApproveClass', () => {
        for (const cls of ['A', 'B', 'C'] as const) {
            for (const p of permissionsToApprove(cls)) expect(canApproveClass(canOf(p), cls)).toBe(true);
        }
    });
});

describe('el caso real: el pañolero y los retiros que antes nacían clase A', () => {
    const panolero = (p: string) => (ROLES.panolero.permissions as string[]).includes(p);
    it('el pañolero NO podía aprobar un retiro guardado como A, pero sí uno C (que es lo que era)', () => {
        expect(canApproveClass(panolero, 'A')).toBe(false);
        expect(canApproveClass(panolero, highestClassOf(['C']))).toBe(true);
        expect(canApproveClass(panolero, highestClassOf(['B', 'C']))).toBe(true);
    });
});
