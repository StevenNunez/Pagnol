import { detailRoute } from '@/lib/api/handler';
import { getActivo } from '@/lib/api/queries';

export const GET = detailRoute('activos:read', ({ db, key, params }) =>
    getActivo(db, key.tenantId, params.id),
);
