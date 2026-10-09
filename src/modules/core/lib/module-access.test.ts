import { describe, it, expect } from 'vitest';
import { canOpenPath } from './module-access';
import { ROLES, type Permission } from './permissions';
import type { UserRole } from './data';

// can() de un rol con sus permisos de fábrica (sin el atajo del administrador).
const canAs = (role: UserRole) => (p: Permission) => ROLES[role].permissions.includes(p);

describe('canOpenPath', () => {
    it('gana la ruta más específica', () => {
        const none = () => false;
        expect(canOpenPath('/dashboard/rrhh', none)).toBe(false);
        expect(canOpenPath('/dashboard/rrhh/mis-solicitudes', none)).toBe(true);
    });

    it('no confunde prefijos parecidos', () => {
        // /dashboard/pagnolx no es /dashboard/pagnol
        expect(canOpenPath('/dashboard/pagnolx', () => false)).toBe(true);
    });

    it('lo personal queda abierto', () => {
        for (const path of ['/dashboard', '/dashboard/wallet', '/dashboard/profile', '/dashboard/worker']) {
            expect(canOpenPath(path, () => false)).toBe(true);
        }
    });

    it('ignora la query', () => {
        expect(canOpenPath('/dashboard/pagnol/solicitudes?paso=por-entregar', canAs('panolero'))).toBe(true);
    });

    it('la plataforma es sólo del super-admin, aunque el administrador pueda todo', () => {
        const all = () => true;
        expect(canOpenPath('/dashboard/subscriptions', all, 'administrador')).toBe(false);
        expect(canOpenPath('/dashboard/super-admin', all, 'administrador')).toBe(false);
        expect(canOpenPath('/dashboard/subscriptions', all, 'super-admin')).toBe(true);
    });
});

describe('quién ve Control de Activos (permisos de fábrica)', () => {
    const SEE: UserRole[] = ['panolero', 'jefe-mantencion', 'director-faena', 'abastecimiento'];
    const DONT: UserRole[] = ['operador', 'supervisor', 'apr', 'cphs', 'jefe-terreno', 'jefe-turno', 'jefe-oficina-tecnica', 'adc', 'gerente-general', 'jefe-operaciones'];

    it.each(SEE)('%s entra', role => {
        expect(canOpenPath('/dashboard/pagnol/activos', canAs(role))).toBe(true);
    });
    it.each(DONT)('%s no entra', role => {
        expect(canOpenPath('/dashboard/pagnol/activos', canAs(role))).toBe(false);
    });

    it('el supervisor y el jefe de operaciones sí piden material', () => {
        expect(canOpenPath('/dashboard/supervisor/request', canAs('supervisor'))).toBe(true);
        // El formulario de compras/arriendos vive bajo /purchasing (lo encontró el E2E).
        expect(canOpenPath('/dashboard/purchasing/purchase-request-form', canAs('supervisor'))).toBe(true);
        expect(canOpenPath('/dashboard/purchasing/orders', canAs('supervisor'))).toBe(false);
        expect(canOpenPath('/dashboard/supervisor/purchase-request-form', canAs('jefe-operaciones'))).toBe(true);
    });

    it('el operador sólo tiene lo personal', () => {
        expect(canOpenPath('/dashboard/supervisor', canAs('operador'))).toBe(false);
        expect(canOpenPath('/dashboard/configuracion', canAs('operador'))).toBe(false);
        expect(canOpenPath('/dashboard/wallet', canAs('operador'))).toBe(true);
    });
});
