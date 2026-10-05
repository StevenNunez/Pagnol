import { detailRoute } from '@/lib/api/handler';
import { getMaterial } from '@/lib/api/queries';

export const GET = detailRoute('materiales:read', ({ db, key, params }) =>
    getMaterial(db, key.tenantId, 'materiales', params.id),
);
