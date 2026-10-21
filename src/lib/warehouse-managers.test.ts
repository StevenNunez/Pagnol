import { describe, it, expect } from 'vitest';
import { managerIdsFromRow, isWarehouseManager, managerNames } from './warehouse-managers';

describe('managerIdsFromRow', () => {
    it('usa la lista de encargados, en orden', () => {
        expect(managerIdsFromRow({ manager_ids: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
    });
    it('sin encargados', () => {
        expect(managerIdsFromRow({})).toEqual([]);
        expect(managerIdsFromRow({ manager_ids: [] })).toEqual([]);
    });
    it('sin repetidos ni vacíos ni valores raros', () => {
        expect(managerIdsFromRow({ manager_ids: ['a', 'a', '', null, 3, 'b'] })).toEqual(['a', 'b']);
        expect(managerIdsFromRow({ manager_ids: 'no-es-lista' })).toEqual([]);
    });
});

describe('isWarehouseManager', () => {
    it('cualquiera de la lista es encargado (los turnos)', () => {
        const w = { managerIds: ['turno-dia', 'turno-noche'] };
        expect(isWarehouseManager(w, 'turno-dia')).toBe(true);
        expect(isWarehouseManager(w, 'turno-noche')).toBe(true);
        expect(isWarehouseManager(w, 'otro')).toBe(false);
    });
    it('sin sesión o sin encargados, nadie', () => {
        expect(isWarehouseManager({ managerIds: ['a'] }, null)).toBe(false);
        expect(isWarehouseManager({ managerIds: ['a'] }, undefined)).toBe(false);
        expect(isWarehouseManager({ managerIds: [] }, 'a')).toBe(false);
        expect(isWarehouseManager({}, 'a')).toBe(false);
    });
});

describe('managerNames', () => {
    it('los nombres en orden, omitiendo a quien ya no tiene ficha', () => {
        const names: Record<string, string> = { a: 'Ana', b: 'Beto' };
        expect(managerNames({ managerIds: ['a', 'fantasma', 'b'] }, id => names[id])).toEqual(['Ana', 'Beto']);
        expect(managerNames({}, id => names[id])).toEqual([]);
    });
});
