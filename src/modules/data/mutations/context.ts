import type { User } from '@/modules/core/lib/data';
import type { Permission } from '@/modules/core/lib/permissions';

// Contexto inyectado por bindContext (DataProvider) en cada mutación.
// Antes cada archivo de mutaciones lo redefinía con `user: any` y un `db: any`
// que nunca se usaba. Centralizado y tipado aquí.
export type MutationContext = {
    user: User | null;
    tenantId: string | null;
    /**
     * Los permisos del usuario, resueltos EXACTAMENTE como los resuelve la
     * pantalla (`useAuth().can`).
     *
     * No se usa `userCan()` en las mutaciones: esa función solo conoce los roles
     * por defecto del código, mientras que `can()` respeta además los permisos
     * que cada empresa personalizó en Gestión de Permisos. Se midió contra la
     * base viva: hay 57 permisos otorgados por empresa que el código no da por
     * defecto — entre ellos los cinco de Control de Obras para
     * `jefe-operaciones`. Validar con `userCan` habría dejado a ese rol viendo
     * los botones y fallando en cada acción.
     */
    can: (permission: Permission) => boolean;
};
