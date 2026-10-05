import { detailRoute } from '@/lib/api/handler';
import { getMaterial } from '@/lib/api/queries';

export const GET = detailRoute('productos:read', ({ db, key, params }) =>
    getMaterial(db, key.tenantId, 'productos', params.id),
);
