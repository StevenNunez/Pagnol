import type { User } from '@/modules/core/lib/data';

// Contexto inyectado por bindContext (DataProvider) en cada mutación.
// Antes cada archivo de mutaciones lo redefinía con `user: any` y un `db: any`
// que nunca se usaba. Centralizado y tipado aquí.
export type MutationContext = {
    user: User | null;
    tenantId: string | null;
};
