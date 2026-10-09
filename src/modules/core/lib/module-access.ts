import type { Permission } from './permissions';

/**
 * Quién puede abrir cada módulo. Una sola tabla para la tarjeta del Panel
 * Central y para la protección por dirección del layout: si ves la tarjeta
 * puedes entrar a sus páginas, y si no la ves, tampoco entras escribiendo la
 * URL. Basta con tener UNO de los permisos de la lista.
 *
 * Gana la ruta más específica (`/dashboard/rrhh/mis-solicitudes` antes que
 * `/dashboard/rrhh`). Una lista vacía = abierta a cualquiera con sesión.
 * Lo que no está aquí (billetera, perfil, inicio del trabajador) es personal
 * y queda abierto.
 */
const ACTIVOS: Permission[] = ['module_pagnol:view', 'module_bodega:view', 'module_warehouse:view'];
const COMPRAS: Permission[] = ['module_abastecimiento:view', 'module_purchasing:view'];

export const MODULE_ACCESS: { prefix: string; anyOf: Permission[]; superAdminOnly?: boolean }[] = [
    { prefix: '/dashboard/pagnol', anyOf: ACTIVOS },
    { prefix: '/dashboard/bodega', anyOf: ACTIVOS }, // redirecciones antiguas hacia Control de Activos
    { prefix: '/dashboard/construction-control', anyOf: ['module_construction_control:view'] },
    { prefix: '/dashboard/work-reports', anyOf: ['module_work_reports:view'] },
    { prefix: '/dashboard/authorizations', anyOf: ['module_authorizations:view'] },
    { prefix: '/dashboard/abastecimiento', anyOf: COMPRAS },
    { prefix: '/dashboard/purchasing', anyOf: COMPRAS },
    // El formulario de compras y arriendos de terreno vive bajo /purchasing por
    // historia, pero lo usa el supervisor: misma regla que su módulo.
    { prefix: '/dashboard/purchasing/purchase-request-form', anyOf: ['material_requests:create', 'purchase_requests:create', 'rentals:request'] },
    { prefix: '/dashboard/users', anyOf: ['module_users:view'] },
    { prefix: '/dashboard/permissions', anyOf: ['module_permissions:view', 'module_users:view'] },
    // Plataforma: sólo super-admin. El administrador tiene control total de SU
    // empresa (can() le devuelve true a todo), pero esto no es de su empresa.
    { prefix: '/dashboard/subscriptions', anyOf: ['module_subscriptions:view'], superAdminOnly: true },
    { prefix: '/dashboard/super-admin', anyOf: ['module_subscriptions:view'], superAdminOnly: true },
    { prefix: '/dashboard/safety', anyOf: ['module_safety:view'] },
    { prefix: '/dashboard/attendance', anyOf: ['module_attendance:view'] },
    { prefix: '/dashboard/payments', anyOf: ['module_payments:view'] },
    { prefix: '/dashboard/reports', anyOf: ['module_reports:view'] },
    { prefix: '/dashboard/supervisor', anyOf: ['material_requests:create', 'purchase_requests:create', 'rentals:request'] },
    { prefix: '/dashboard/estado-pago', anyOf: ['construction_control:register_progress', 'payment_states:approve', 'payment_states:pay'] },
    { prefix: '/dashboard/cphs', anyOf: ['safety_checklists:review'] },
    { prefix: '/dashboard/finanzas', anyOf: ['module_finance:view'] },
    { prefix: '/dashboard/dte', anyOf: ['module_dte:view'] },
    { prefix: '/dashboard/rentals', anyOf: ['module_rentals:view'] },
    { prefix: '/dashboard/rrhh', anyOf: ['module_rrhh:view'] },
    { prefix: '/dashboard/rrhh/mis-solicitudes', anyOf: [] },
    { prefix: '/dashboard/configuracion', anyOf: ['module_settings:view'] },
];

function ruleFor(pathname: string) {
    let best: (typeof MODULE_ACCESS)[number] | null = null;
    for (const r of MODULE_ACCESS) {
        if (pathname === r.prefix || pathname.startsWith(r.prefix + '/')) {
            if (!best || r.prefix.length > best.prefix.length) best = r;
        }
    }
    return best;
}

/** ¿Puede este usuario abrir esta dirección del dashboard? */
export function canOpenPath(pathname: string, can: (p: Permission) => boolean, role?: string | null): boolean {
    const rule = ruleFor(pathname.split('?')[0]);
    if (!rule) return true;
    if (rule.superAdminOnly) return role === 'super-admin';
    if (rule.anyOf.length === 0) return true;
    return rule.anyOf.some(p => can(p));
}
