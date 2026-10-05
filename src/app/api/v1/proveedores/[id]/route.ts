import { detailRoute } from '@/lib/api/handler';
import { getProveedor } from '@/lib/api/queries';

export const GET = detailRoute('proveedores:read', ({ db, key, params }) =>
    getProveedor(db, key.tenantId, params.id),
);
