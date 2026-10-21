import { describe, it, expect } from 'vitest';
import { pendingEquipmentOf, separationNotifyIds } from './worker-separation';
import type { Material, MaterialRequest, ReturnRequest } from '@/modules/core/lib/data';

const mat = (id: string, usageType: string, over: Partial<Material> = {}) =>
    ({ id, name: `Mat ${id}`, usageType, category: 'Herramientas', archived: false, ...over }) as unknown as Material;
const out = (id: string, to: string, at: string, materialId: string) =>
    ({ id, status: 'approved', supervisorId: to, receivedByUserId: to, approvalDate: new Date(at), createdAt: new Date(at), items: [{ materialId, quantity: 1 }] }) as unknown as MaterialRequest;
const back = (id: string, from: string, at: string, materialId: string) =>
    ({ id, status: 'completed', supervisorId: from, materialId, completionDate: new Date(at), createdAt: new Date(at), quantity: 1 }) as unknown as ReturnRequest;

describe('pendingEquipmentOf', () => {
    const materials = [
        mat('taladro', 'Herramienta Menor'),
        mat('esmeril', 'Herramienta Menor'),
        mat('cable', 'Consumible'),
        mat('casco', 'Reutilizable Controlado', { category: 'EPP (Elementos de Protección Personal)' }),
    ];

    it('lista lo que tiene y no devolvió, sólo equipos', () => {
        const reqs = [
            out('1', 'juan', '2026-10-01', 'taladro'),
            out('2', 'juan', '2026-10-02', 'cable'),
            out('3', 'juan', '2026-10-02', 'casco'),
        ];
        const r = pendingEquipmentOf('juan', materials, reqs, []);
        expect(r.map(x => x.materialId)).toEqual(['taladro']);
    });

    it('lo devuelto ya no es pendiente', () => {
        const reqs = [out('1', 'juan', '2026-10-01', 'taladro')];
        expect(pendingEquipmentOf('juan', materials, reqs, [back('r', 'juan', '2026-10-03', 'taladro')])).toEqual([]);
    });

    it('lo que pasó a otra persona después no es de él', () => {
        const reqs = [out('1', 'juan', '2026-10-01', 'taladro'), out('2', 'pedro', '2026-10-05', 'taladro')];
        expect(pendingEquipmentOf('juan', materials, reqs, [])).toEqual([]);
        expect(pendingEquipmentOf('pedro', materials, reqs, []).map(x => x.materialId)).toEqual(['taladro']);
    });

    it('ignora equipos archivados', () => {
        const reqs = [out('1', 'juan', '2026-10-01', 'esmeril')];
        expect(pendingEquipmentOf('juan', [mat('esmeril', 'Herramienta Menor', { archived: true })], reqs, [])).toEqual([]);
    });
});

describe('separationNotifyIds', () => {
    const users = [
        { id: 'juan', role: 'operador', responsibleSupervisorId: 'supA' },
        { id: 'supA', role: 'supervisor' },
        { id: 'supB', role: 'supervisor' },
        { id: 'pan', role: 'panolero' },
        { id: 'enc', role: 'operador' },
        { id: 'turno-noche', role: 'operador' },
        { id: 'rrhh', role: 'recursos-humanos' },
        { id: 'baja', role: 'panolero', employmentStatus: 'terminated' },
    ];
    const contractWorkers = [
        { contractId: 'c1', userId: 'supB' }, { contractId: 'c1', userId: 'juan' },
    ];
    const warehouses = [{ managerIds: ['enc'] }, { managerIds: ['baja'] }, { managerIds: [] }, { managerIds: ['turno-noche', 'enc'] }];

    it('avisa a bodega y al supervisor responsable, no al contrato', () => {
        const ids = separationNotifyIds('juan', 'rrhh', 'c1', { users, contractWorkers, warehouses });
        // «turno-noche» es el segundo encargado de un pañol: también se le avisa (antes sólo el primero).
        expect(ids.sort()).toEqual(['enc', 'pan', 'supA', 'turno-noche']);
    });

    it('sin responsable asignado cae a los supervisores del contrato', () => {
        const u = users.map(x => x.id === 'juan' ? { ...x, responsibleSupervisorId: null } : x);
        const ids = separationNotifyIds('juan', 'rrhh', 'c1', { users: u, contractWorkers, warehouses });
        expect(ids.sort()).toEqual(['enc', 'pan', 'supB', 'turno-noche']);
    });

    it('nunca a quien se va, a quien lo desvincula ni a gente dada de baja', () => {
        const ids = separationNotifyIds('juan', 'pan', 'c1', { users, contractWorkers, warehouses });
        expect(ids).not.toContain('juan');
        expect(ids).not.toContain('pan');
        expect(ids).not.toContain('baja');
    });
});
