import { detailRoute, writeRoute } from '@/lib/api/handler';
import { getActivo, patchActivo } from '@/lib/api/queries';
import { PatchActivoBodySchema } from '@/lib/api/schemas';

export const GET = detailRoute('activos:read', ({ db, key, params }) =>
    getActivo(db, key.tenantId, params.id),
);

export const PATCH = writeRoute('activos:write', PatchActivoBodySchema, async ({ db, key, params, body }) => ({
    status: 200,
    body: await patchActivo(db, key.tenantId, params.id!, body),
}), { idParam: true });
