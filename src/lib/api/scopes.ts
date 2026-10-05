// Scopes de las llaves de la API pública v1. Deben coincidir con el CHECK
// `api_keys_scopes_valid` de la migración 20261005000000.
export const API_SCOPES = [
    'materiales:read',
    'productos:read',
    'proveedores:read',
    'proveedores:write',
    'activos:read',
    'activos:write',
    'webhooks:manage',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/** Descripción legible de cada scope, para la pantalla de Configuración. */
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
    'materiales:read': 'Leer el catálogo de materiales',
    'productos:read': 'Leer productos (consumibles)',
    'proveedores:read': 'Leer proveedores',
    'proveedores:write': 'Crear y editar proveedores',
    'activos:read': 'Leer activos',
    'activos:write': 'Crear y editar activos',
    'webhooks:manage': 'Administrar webhooks',
};

/** Scopes que la API ya atiende (Fase 1). Los demás se pueden otorgar, pero aún no abren nada. */
export const API_SCOPES_AVAILABLE: readonly ApiScope[] = [
    'materiales:read',
    'productos:read',
    'proveedores:read',
    'activos:read',
];
