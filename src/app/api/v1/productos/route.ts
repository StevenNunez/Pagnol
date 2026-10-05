import { listRoute } from '@/lib/api/handler';
import { listMateriales } from '@/lib/api/queries';
import { MaterialesQuerySchema } from '@/lib/api/schemas';

export const GET = listRoute('productos:read', MaterialesQuerySchema, ({ db, key, params }) =>
    listMateriales(db, key.tenantId, 'productos', params),
);
