import { listRoute } from '@/lib/api/handler';
import { listActivos } from '@/lib/api/queries';
import { ActivosQuerySchema } from '@/lib/api/schemas';

export const GET = listRoute('activos:read', ActivosQuerySchema, ({ db, key, params }) =>
    listActivos(db, key.tenantId, params),
);
