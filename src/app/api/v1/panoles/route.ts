import { z } from 'zod';
import { listRoute } from '@/lib/api/handler';
import { listPanoles } from '@/lib/api/queries';

export const GET = listRoute(['activos:read', 'materiales:read', 'productos:read'], z.object({}), ({ db, key }) =>
    listPanoles(db, key.tenantId),
);
