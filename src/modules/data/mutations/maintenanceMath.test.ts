import { describe, it, expect } from 'vitest';
import { assetStatusAfterOrders, takesOutOfService, isOpenOrder } from './maintenanceMath';

const OT = (status: string, type = 'CORRECTIVE') => ({ status, type });
const asset = (status: string, inUse = 0, usageType = 'Herramienta Menor') => ({ status, inUse, usageType });

describe('takesOutOfService', () => {
    it('una correctiva abierta o cualquiera en curso retiene al equipo', () => {
        expect(takesOutOfService(OT('OPEN', 'CORRECTIVE'))).toBe(true);
        expect(takesOutOfService(OT('IN_PROGRESS', 'PREVENTIVE'))).toBe(true);
        expect(takesOutOfService(OT('WAITING_PARTS', 'CORRECTIVE'))).toBe(true);
    });
    it('una preventiva sólo programada, no; una cerrada, tampoco', () => {
        expect(takesOutOfService(OT('OPEN', 'PREVENTIVE'))).toBe(false);
        expect(takesOutOfService(OT('OPEN', 'PREDICTIVE'))).toBe(false);
        expect(takesOutOfService(OT('COMPLETED'))).toBe(false);
        expect(takesOutOfService(OT('CANCELLED'))).toBe(false);
    });
    it('isOpenOrder', () => {
        expect(['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'].every(s => isOpenOrder({ status: s }))).toBe(true);
        expect(isOpenOrder({ status: 'COMPLETED' })).toBe(false);
    });
});

describe('assetStatusAfterOrders', () => {
    it('abrir una OT correctiva pasa un equipo disponible a «En Mantenimiento»', () => {
        expect(assetStatusAfterOrders(asset('Disponible'), [OT('OPEN')])).toBe('En Mantenimiento');
    });
    it('cerrar la última OT lo devuelve: a «Disponible», o a «En Uso» si alguien aún tiene unidades', () => {
        expect(assetStatusAfterOrders(asset('En Mantenimiento'), [OT('COMPLETED')])).toBe('Disponible');
        expect(assetStatusAfterOrders(asset('En Mantenimiento', 2), [OT('COMPLETED')])).toBe('En Uso');
        expect(assetStatusAfterOrders(asset('En Mantenimiento'), [])).toBe('Disponible');
    });
    it('con otra OT todavía abierta no lo devuelve', () => {
        expect(assetStatusAfterOrders(asset('En Mantenimiento'), [OT('COMPLETED'), OT('IN_PROGRESS', 'PREVENTIVE')])).toBeNull();
    });
    it('un equipo que está con un trabajador («En Uso») no se toca al abrir la OT', () => {
        expect(assetStatusAfterOrders(asset('En Uso', 1), [OT('OPEN')])).toBeNull();
    });
    it('una preventiva sólo programada no saca al equipo de servicio', () => {
        expect(assetStatusAfterOrders(asset('Disponible'), [OT('OPEN', 'PREVENTIVE')])).toBeNull();
    });
    it('un consumible y un equipo «Para Baja» no cambian', () => {
        expect(assetStatusAfterOrders(asset('Disponible', 0, 'Consumible'), [OT('OPEN')])).toBeNull();
        expect(assetStatusAfterOrders(asset('Para Baja'), [OT('OPEN')])).toBeNull();
        expect(assetStatusAfterOrders(asset('Para Baja'), [])).toBeNull();
    });
    it('ya en el estado correcto: nada que hacer', () => {
        expect(assetStatusAfterOrders(asset('En Mantenimiento'), [OT('OPEN')])).toBeNull();
        expect(assetStatusAfterOrders(asset('Disponible'), [OT('COMPLETED')])).toBeNull();
    });
});
