import { detailRoute, writeRoute } from '@/lib/api/handler';
import { getCompra, patchCompra } from '@/lib/api/queries';
import { PatchCompraBodySchema } from '@/lib/api/schemas';

export const GET = detailRoute('compras:read', ({ db, key, params }) =>
    getCompra(db, key.tenantId, params.id),
);

export const PATCH = writeRoute('compras:write', PatchCompraBodySchema, async ({ db, key, params, body }) => ({
    status: 200,
    body: await patchCompra(db, key.tenantId, params.id!, body),
}), { idParam: true });
