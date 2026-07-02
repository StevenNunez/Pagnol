import { useMemo } from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { PLANS, ROLES_ORDER } from '@/modules/core/lib/permissions';
import type { UserRole, Tenant } from '@/modules/core/lib/data';

/**
 * Roles que el usuario actual puede ASIGNAR, según el plan del tenant.
 *
 * Fuente única de la lógica que antes estaba copiada en create-user-form,
 * invitaciones y enrollment-wizard: ROLES_ORDER ∩ plan.allowedRoles, excluyendo
 * `super-admin` salvo que el actor lo sea.
 */
export function useAssignableRoles(): UserRole[] {
    const { user, currentTenantId, tenants } = useAuth();
    return useMemo(() => {
        const currentTenant = (tenants || []).find(
            (t: Tenant) => t.id === currentTenantId || t.tenantId === currentTenantId
        );
        const plan = PLANS[(currentTenant as Tenant & { plan?: keyof typeof PLANS })?.plan as keyof typeof PLANS] || PLANS.professional;
        const ordered = ROLES_ORDER.filter(r => plan.allowedRoles.includes(r));
        return user?.role === 'super-admin' ? ordered : ordered.filter(r => r !== 'super-admin');
    }, [tenants, currentTenantId, user]);
}
