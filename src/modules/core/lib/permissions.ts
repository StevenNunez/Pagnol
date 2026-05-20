

// src/modules/core/lib/permissions.ts

import type { UserRole } from "./data";

/* ===================================================================
   TODOS LOS PERMISOS DISPONIBLES EN LA PLATAFORMA
   =================================================================== */
export const ALL_PERMISSIONS = {
    // ── Acceso a Módulos ─────────────────────────────────────────────
    'module_pagnol:view': { label: 'Acceder a Módulo Pagnol', group: 'Acceso a Módulos' },
    'module_warehouse:view': { label: 'Acceder a Bodega Central', group: 'Acceso a Módulos' },
    'module_bodega:view': { label: 'Acceder a Bodega (Módulo)', group: 'Acceso a Módulos' },
    'module_purchasing:view': { label: 'Acceder a Compras', group: 'Acceso a Módulos' },
    'module_users:view': { label: 'Acceder a Usuarios', group: 'Acceso a Módulos' },
    'module_subscriptions:view': { label: 'Acceder a Suscripciones', group: 'Plataforma' },
    'module_safety:view': { label: 'Acceder a Prevención', group: 'Acceso a Módulos' },
    'module_attendance:view': { label: 'Acceder a Asistencia', group: 'Acceso a Módulos' },
    'module_payments:view': { label: 'Acceder a Pagos', group: 'Acceso a Módulos' },
    'module_reports:view': { label: 'Acceder a Reportes', group: 'Acceso a Módulos' },
    'module_permissions:view': { label: 'Ver Gestión de Permisos', group: 'Acceso a Módulos' },
    'module_construction_control:view': { label: 'Acceder a Control de Obra', group: 'Acceso a Módulos' },
    'pagnol:enroll_personal': { label: 'Enrolar Personal y Biometría', group: 'Módulo Pagnol' },


    // ── Gestión de permisos (el permiso que realmente abre el módulo) ──
    'permissions:manage': { label: 'Gestionar Permisos de Roles', group: 'Plataforma' },

    // ── Plataforma (solo Super Admin) ───────────────────────────────
    'tenants:create': { label: 'Crear Nuevos Tenants', group: 'Plataforma' },
    'tenants:delete': { label: 'Eliminar Tenants', group: 'Plataforma' },
    'tenants:switch': { label: 'Cambiar entre Tenants', group: 'Plataforma' },
    'tools:create': { label: 'Crear Herramientas', group: 'Herramientas' },
    'tools:view_all': { label: 'Ver Todas las Herramientas', group: 'Herramientas' },
    'tools:edit': { label: 'Editar Herramientas', group: 'Herramientas' },
    'tools:delete': { label: 'Eliminar Herramientas', group: 'Herramientas' },
    'tools:checkout': { label: 'Entregar Herramientas', group: 'Herramientas' },
    'tools:return': { label: 'Recibir Herramientas', group: 'Herramientas' },
    'tools:view_own': { label: 'Ver Mis Herramientas', group: 'Herramientas' },

    'materials:create': { label: 'Crear Materiales', group: 'Materiales y Stock' },
    'materials:view_all': { label: 'Ver Todos los Materiales', group: 'Materiales y Stock' },
    'materials:edit': { label: 'Editar Materiales', group: 'Materiales y Stock' },
    'materials:delete': { label: 'Eliminar Materiales', group: 'Materiales y Stock' },
    'materials:archive': { label: 'Archivar Materiales', group: 'Materiales y Stock' },
    'stock:add_manual': { label: 'Ingresar Stock Manualmente', group: 'Materiales y Stock' },
    'stock:receive_order': { label: 'Recibir Material de Compra', group: 'Materiales y Stock' },

    'material_requests:create': { label: 'Crear Solicitudes de Material', group: 'Solicitudes Internas' },
    'material_requests:approve_class_a': { label: 'Aprobar Solicitudes Clase A (Críticos)', group: 'Solicitudes Internas' },
    'material_requests:approve_class_b': { label: 'Aprobar Solicitudes Clase B (Importantes)', group: 'Solicitudes Internas' },
    'material_requests:approve_class_c': { label: 'Aprobar Solicitudes Clase C (Fungibles)', group: 'Solicitudes Internas' },
    'material_requests:view_own': { label: 'Ver Mis Solicitudes', group: 'Solicitudes Internas' },
    'material_requests:view_all': { label: 'Ver Todas las Solicitudes', group: 'Solicitudes Internas' },
    'material_requests:approve': { label: 'Aprobar/Rechazar Solicitudes', group: 'Solicitudes Internas' },

    'return_requests:create': { label: 'Crear Devoluciones', group: 'Devoluciones' },
    'return_requests:approve': { label: 'Aprobar Devoluciones', group: 'Devoluciones' },
    'return_requests:view_all': { label: 'Ver Todas las Devoluciones', group: 'Devoluciones' },

    'purchase_requests:create': { label: 'Crear Solicitudes de Compra', group: 'Compras' },
    'purchase_requests:approve': { label: 'Aprobar Solicitudes de Compra', group: 'Compras' },
    'purchase_requests:view_all': { label: 'Ver Solicitudes de Compra', group: 'Compras' },
    'purchase_requests:delete': { label: 'Eliminar Solicitudes de Compra', group: 'Compras' },
    'lots:create': { label: 'Crear Lotes de Compra', group: 'Compras' },
    'lots:assign': { label: 'Asignar Solicitudes a Lotes', group: 'Compras' },
    'lots:delete': { label: 'Eliminar Lotes', group: 'Compras' },
    'orders:create': { label: 'Generar Cotizaciones', group: 'Compras' },
    'orders:view_all': { label: 'Ver Cotizaciones', group: 'Compras' },
    'orders:cancel': { label: 'Anular Cotizaciones', group: 'Compras' },

    'finance:manage_purchase_orders': { label: 'Generar OC Oficiales', group: 'Finanzas' },

    'users:create': { label: 'Crear Usuarios', group: 'Usuarios' },
    'users:view': { label: 'Ver Usuarios', group: 'Usuarios' },
    'users:edit': { label: 'Editar Usuarios', group: 'Usuarios' },
    'users:delete': { label: 'Eliminar Usuarios', group: 'Usuarios' },
    'users:change_password': { label: 'Cambiar Contraseña de Otros', group: 'Usuarios' },
    'users:print_qr': { label: 'Imprimir Credenciales', group: 'Usuarios' },

    'suppliers:create': { label: 'Crear Proveedores', group: 'Configuración' },
    'suppliers:view': { label: 'Ver Proveedores', group: 'Configuración' },
    'suppliers:edit': { label: 'Editar Proveedores', group: 'Configuración' },
    'suppliers:delete': { label: 'Eliminar Proveedores', group: 'Configuración' },
    'categories:create': { label: 'Crear Categorías', group: 'Configuración' },
    'categories:view': { label: 'Ver Categorías', group: 'Configuración' },
    'categories:edit': { label: 'Editar Categorías', group: 'Configuración' },
    'categories:delete': { label: 'Eliminar Categorías', group: 'Configuración' },
    'units:create': { label: 'Crear Unidades', group: 'Configuración' },
    'units:view': { label: 'Ver Unidades', group: 'Configuración' },
    'units:delete': { label: 'Eliminar Unidades', group: 'Configuración' },

    'payments:create': { label: 'Ingresar Facturas', group: 'Pagos' },
    'payments:view': { label: 'Ver Pagos', group: 'Pagos' },
    'payments:mark_as_paid': { label: 'Marcar Facturas como Pagadas', group: 'Pagos' },
    'payments:delete': { label: 'Eliminar Facturas', group: 'Pagos' },
    'payments:edit': { label: 'Editar Facturas', group: 'Pagos' },

    'attendance:register': { label: 'Registrar Asistencia (QR)', group: 'Asistencia' },
    'attendance:edit': { label: 'Editar Registros de Asistencia', group: 'Asistencia' },
    'attendance:view': { label: 'Ver Asistencia', group: 'Asistencia' },

    'reports:view': { label: 'Ver Reportes', group: 'Reportes' },

    'safety_templates:create': { label: 'Crear Plantillas de Seguridad', group: 'Prevención de Riesgos' },
    'safety_templates:assign': { label: 'Asignar Checklists/Inspecciones', group: 'Prevención de Riesgos' },
    'safety_checklists:complete': { label: 'Completar Mis Checklists', group: 'Prevención de Riesgos' },
    'safety_checklists:review': { label: 'Revisar Checklists', group: 'Prevención de Riesgos' },
    'safety_inspections:create': { label: 'Crear Inspecciones', group: 'Prevención de Riesgos' },
    'safety_inspections:complete': { label: 'Completar Mis Inspecciones', group: 'Prevención de Riesgos' },
    'safety_inspections:review': { label: 'Revisar Inspecciones', group: 'Prevención de Riesgos' },
    'safety_observations:create': { label: 'Crear Observaciones', group: 'Prevención de Riesgos' },
    'safety_observations:review': { label: 'Revisar Observaciones', group: 'Prevención de Riesgos' },

    'construction_control:register_progress': { label: 'Registrar Avance Diario', group: 'Control de Obra' },
    'construction_control:edit_structure': { label: 'Editar Estructura de Partidas', group: 'Control de Obra' },
    'construction_control:view_reports': { label: 'Ver Reportes de Avance', group: 'Control de Obra' },
    'construction_control:review_protocols': { label: 'Revisar y Aprobar Protocolos', group: 'Control de Obra' },


} as const;

export type Permission = keyof typeof ALL_PERMISSIONS;
export const PERMISSIONS = ALL_PERMISSIONS;

export const ROLES: Record<UserRole, { label: string; description: string; permissions: Permission[] }> = {
    'super-admin': {
        label: 'Super Admin',
        description: 'Control total de la plataforma y todos los tenants/suscriptores.',
        permissions: Object.keys(ALL_PERMISSIONS) as Permission[],
    },
    'administrador': {
        label: 'Administrador',
        description: 'Dueño de la cuenta SaaS. Control total del tenant: usuarios, roles, módulos y configuración.',
        permissions: [
            // Módulos
            'module_pagnol:view', 'module_warehouse:view', 'module_bodega:view',
            'module_purchasing:view', 'module_users:view', 'module_safety:view',
            'module_attendance:view', 'module_payments:view', 'module_reports:view',
            'module_permissions:view', 'module_construction_control:view',
            // Activos y Stock
            'materials:create', 'materials:view_all', 'materials:edit', 'materials:delete', 'materials:archive',
            'tools:create', 'tools:view_all', 'tools:edit', 'tools:delete', 'tools:checkout', 'tools:return',
            'stock:add_manual', 'stock:receive_order',
            // Solicitudes
            'material_requests:view_all', 'material_requests:approve',
            'material_requests:approve_class_a', 'material_requests:approve_class_b', 'material_requests:approve_class_c',
            'return_requests:view_all', 'return_requests:approve', 'return_requests:create',
            'purchase_requests:create', 'purchase_requests:view_all', 'purchase_requests:approve', 'purchase_requests:delete',
            // Compras
            'lots:create', 'lots:assign', 'lots:delete',
            'orders:create', 'orders:view_all', 'orders:cancel',
            // Finanzas
            'finance:manage_purchase_orders',
            'payments:create', 'payments:view', 'payments:mark_as_paid', 'payments:edit', 'payments:delete',
            // Usuarios
            'users:create', 'users:view', 'users:edit', 'users:delete', 'users:change_password', 'users:print_qr',
            // Configuración
            'suppliers:create', 'suppliers:view', 'suppliers:edit', 'suppliers:delete',
            'categories:create', 'categories:view', 'categories:edit', 'categories:delete',
            'units:create', 'units:view', 'units:delete',
            // Seguridad
            'safety_templates:create', 'safety_templates:assign',
            'safety_checklists:complete', 'safety_checklists:review',
            'safety_inspections:create', 'safety_inspections:complete', 'safety_inspections:review',
            'safety_observations:create', 'safety_observations:review',
            // Asistencia
            'attendance:register', 'attendance:edit', 'attendance:view',
            // Reportes
            'reports:view',
            // Control de Obra
            'construction_control:register_progress', 'construction_control:edit_structure',
            'construction_control:view_reports', 'construction_control:review_protocols',
            // Permisos
            'permissions:manage',
            // Pagnol
            'pagnol:enroll_personal',
        ],
    },
    'director-faena': {
        label: 'Director de Faena',
        description: 'Responsable técnico y legal de la operación minera (DS 132). Visibilidad total operacional.',
        permissions: [
            'module_pagnol:view', 'module_warehouse:view', 'module_construction_control:view',
            'module_safety:view', 'module_attendance:view', 'module_reports:view',
            'module_purchasing:view', 'module_users:view',
            'materials:view_all', 'tools:view_all',
            'material_requests:view_all', 'material_requests:approve',
            'material_requests:approve_class_a', 'material_requests:approve_class_b', 'material_requests:approve_class_c',
            'return_requests:view_all', 'return_requests:create',
            'purchase_requests:view_all', 'purchase_requests:create',
            'users:view',
            'safety_templates:create', 'safety_templates:assign',
            'safety_checklists:complete', 'safety_checklists:review',
            'safety_inspections:create', 'safety_inspections:complete', 'safety_inspections:review',
            'safety_observations:create', 'safety_observations:review',
            'attendance:view', 'attendance:edit',
            'reports:view',
            'construction_control:register_progress', 'construction_control:edit_structure',
            'construction_control:view_reports', 'construction_control:review_protocols',
        ],
    },
    'jefe-oficina-tecnica': {
        label: 'Jefe de Oficina Técnica',
        description: 'Planifica la Carta Gantt, presupuestos y supervisa el avance técnico y financiero de la obra.',
        permissions: [
            'module_construction_control:view',
            'construction_control:edit_structure', 'construction_control:register_progress',
            'construction_control:view_reports', 'construction_control:review_protocols',
            'module_purchasing:view', 'purchase_requests:create', 'purchase_requests:view_all',
            'module_warehouse:view', 'materials:view_all', 'material_requests:create',
            'module_reports:view', 'reports:view',
        ],
    },
    'jefe-terreno': {
        label: 'Jefe de Terreno',
        description: 'Gestiona el avance físico de la obra y a los supervisores.',
        permissions: [
            'module_construction_control:view',
            'construction_control:register_progress',
            'construction_control:view_reports',
            'construction_control:review_protocols',
            'module_warehouse:view',
            'material_requests:create',
            'purchase_requests:create',
            'return_requests:create',
            'tools:view_own',
        ],
    },
    'panolero': {
        label: 'Pañolero',
        description: 'Operador diario del pañol digital. Gestiona inventario y transacciones.',
        permissions: [
            'module_pagnol:view', 'module_warehouse:view', 'module_bodega:view',
            'materials:view_all', 'materials:edit', 'materials:create',
            'tools:view_all', 'tools:checkout', 'tools:return',
            'stock:receive_order', 'stock:add_manual',
            'material_requests:view_all', 'material_requests:approve',
            'material_requests:approve_class_b', 'material_requests:approve_class_c',
            'return_requests:view_all', 'return_requests:approve',
            'purchase_requests:view_all',
        ],
    },
    'finance': {
        label: 'Jefe de Finanzas',
        description: 'Gestiona facturas, pagos a proveedores y controla la planilla.',
        permissions: [
            'module_payments:view',
            'payments:create', 'payments:view', 'payments:mark_as_paid', 'payments:edit', 'payments:delete',
            'suppliers:view', 'suppliers:edit', 'suppliers:create',
            'module_purchasing:view', 'orders:view_all',
            'finance:manage_purchase_orders',
            'module_attendance:view', 'attendance:view',
            'module_reports:view', 'reports:view',
        ],
    },
    'supervisor': {
        label: 'Supervisor',
        description: 'Solicita materiales, registra devoluciones y gestiona su cuadrilla.',
        permissions: [
            'module_pagnol:view',
            'materials:view_all',
            'tools:view_own',
            'material_requests:create',
            'material_requests:view_own',
            'purchase_requests:create',
            'return_requests:create',
        ],
    },
    'apr': {
        label: 'APR (Prevencionista)',
        description: 'Gestiona checklists, inspecciones y observaciones de seguridad.',
        permissions: [
            'module_safety:view', 'module_users:view', 'module_warehouse:view', 'module_reports:view',
            'safety_templates:create', 'safety_templates:assign',
            'safety_checklists:complete', 'safety_checklists:review',
            'safety_inspections:create', 'safety_inspections:complete', 'safety_inspections:review',
            'safety_observations:create', 'safety_observations:review',
            'material_requests:create', 'purchase_requests:create', 'return_requests:create',
            'reports:view',
        ],
    },
    'cphs': {
        label: 'Comité Paritario (CPHS)',
        description: 'Comité Paritario de Higiene y Seguridad.',
        permissions: [
            'module_safety:view', 'module_warehouse:view', 'module_users:view',
            'tools:view_own',
            'safety_templates:create', 'safety_templates:assign',
            'safety_checklists:review', 'safety_checklists:complete',
            'safety_inspections:create', 'safety_inspections:review', 'safety_inspections:complete',
            'safety_observations:create', 'safety_observations:review',
        ],
    },
    'quality': {
        label: 'Calidad',
        description: 'Verifica la correcta ejecución de las partidas de obra.',
        permissions: [
            'module_construction_control:view',
            'construction_control:view_reports',
            'construction_control:review_protocols',
        ],
    },
    'contratista': {
        label: 'Contratista',
        description: 'Accede a sus contratos, estado de pago y registra avance de sus partidas.',
        permissions: [
            'module_construction_control:view',
            'construction_control:register_progress',
            'construction_control:view_reports',
        ],
    },
    'guardia': {
        label: 'Guardia',
        description: 'Registra asistencia con QR en acceso a faena.',
        permissions: ['module_attendance:view', 'attendance:register'],
    },
    'jefe-turno': {
        label: 'Jefe de Turno',
        description: 'Gestiona un turno de trabajo: personal presente, herramientas y seguridad del período.',
        permissions: [
            'module_pagnol:view', 'module_attendance:view', 'module_safety:view',
            'materials:view_all', 'tools:view_own',
            'material_requests:create', 'material_requests:view_own',
            'return_requests:create',
            'attendance:register', 'attendance:view',
            'safety_observations:create',
            'safety_inspections:create', 'safety_inspections:complete',
            'safety_checklists:complete',
        ],
    },
    'jefe-mantencion': {
        label: 'Jefe de Mantención',
        description: 'Gestiona el mantenimiento de equipos y herramientas. Solicita repuestos y materiales.',
        permissions: [
            'module_pagnol:view', 'module_warehouse:view', 'module_bodega:view',
            'module_purchasing:view',
            'materials:view_all', 'materials:edit',
            'tools:view_all', 'tools:checkout', 'tools:return', 'tools:edit',
            'stock:receive_order',
            'material_requests:create', 'material_requests:view_own',
            'return_requests:create',
            'purchase_requests:create', 'purchase_requests:view_all',
            'module_reports:view', 'reports:view',
        ],
    },
    'geologo': {
        label: 'Geólogo',
        description: 'Acceso a datos técnicos de avance, cubicaciones y reportes geológicos de la faena.',
        permissions: [
            'module_construction_control:view',
            'construction_control:register_progress',
            'construction_control:view_reports',
            'module_reports:view', 'reports:view',
        ],
    },
    'topografo': {
        label: 'Topógrafo',
        description: 'Registra mediciones y avances de obra. Genera reportes de levantamiento topográfico.',
        permissions: [
            'module_construction_control:view',
            'construction_control:register_progress',
            'construction_control:view_reports',
            'module_reports:view', 'reports:view',
        ],
    },
    'operador': {
        label: 'Operador',
        description: 'Operador de la faena. Puede ver y usar las herramientas que le han sido asignadas.',
        permissions: ['module_pagnol:view', 'tools:view_own'],
    },
};

export const ROLES_ORDER: UserRole[] = [
    'super-admin',
    'administrador',
    'director-faena',
    'jefe-oficina-tecnica',
    'jefe-terreno',
    'jefe-turno',
    'jefe-mantencion',
    'panolero',
    'finance',
    'supervisor',
    'apr',
    'cphs',
    'quality',
    'geologo',
    'topografo',
    'contratista',
    'guardia',
    'operador',
];

export const PLANS = {
    basic: {
        plan: 'basic',
        features: { basic: true, pro: false, enterprise: false },
        allowedRoles: ['panolero', 'supervisor', 'operador', 'guardia'] as UserRole[],
    },
    professional: {
        plan: 'pro',
        features: { basic: true, pro: true, enterprise: false },
        allowedRoles: [
            'administrador',
            'director-faena',
            'panolero',
            'jefe-oficina-tecnica',
            'jefe-terreno',
            'jefe-turno',
            'jefe-mantencion',
            'supervisor',
            'apr',
            'finance',
            'guardia',
            'operador',
            'cphs',
            'quality',
            'geologo',
            'topografo',
            'contratista',
        ] as UserRole[],
    },
    enterprise: {
        plan: 'enterprise',
        features: { basic: true, pro: true, enterprise: true },
        allowedRoles: Object.keys(ROLES) as UserRole[],
    },
};
