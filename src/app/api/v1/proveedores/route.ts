import { listRoute } from '@/lib/api/handler';
import { listProveedores } from '@/lib/api/queries';
import { ProveedoresQuerySchema } from '@/lib/api/schemas';

export const GET = listRoute('proveedores:read', ProveedoresQuerySchema, ({ db, key, params }) =>
    listProveedores(db, key.tenantId, params),
);
