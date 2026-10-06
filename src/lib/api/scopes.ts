// Scopes de las llaves de la API pública v1. Deben coincidir con el CHECK
// `api_keys_scopes_valid` (migraciones 20261005000000 y 20261006000000).
export const API_SCOPES = [
    'materiales:read',
    'productos:read',
    'proveedores:read',
    'proveedores:write',
    'activos:read',
    'activos:write',
    'stock:write',
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
    'activos:write': 'Crear activos al recibirlos y editar su estado',
    'stock:write': 'Ingresar stock de consumibles al recibirlos',
    'webhooks:manage': 'Administrar webhooks',
};

/** Scopes que la API ya atiende. Los demás existen en el contrato pero aún no abren nada. */
export const API_SCOPES_AVAILABLE: readonly ApiScope[] = [
    'materiales:read',
    'productos:read',
    'proveedores:read',
    'activos:read',
    'activos:write',
    'stock:write',
];

/** Los de escritura se marcan a propósito al crear la llave; por defecto sólo lectura. */
export const API_SCOPES_DEFAULT: readonly ApiScope[] = API_SCOPES_AVAILABLE.filter(s => s.endsWith(':read'));
