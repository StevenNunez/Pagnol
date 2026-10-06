import { detailRoute } from '@/lib/api/handler';
import { getExistencias } from '@/lib/api/queries';

export const GET = detailRoute(['materiales:read', 'productos:read', 'activos:read'], ({ db, key, params }) =>
    getExistencias(db, key.tenantId, params.id),
);
