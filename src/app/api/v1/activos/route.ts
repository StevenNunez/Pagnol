import { listRoute, writeRoute } from '@/lib/api/handler';
import { createActivo, listActivos } from '@/lib/api/queries';
import { ActivosQuerySchema, CreateActivoBodySchema } from '@/lib/api/schemas';

export const GET = listRoute('activos:read', ActivosQuerySchema, ({ db, key, params }) =>
    listActivos(db, key.tenantId, params),
);

// Una unidad por llamada, al recepcionarla. 201 = creada; 200 = ya existía con esa external_ref.
export const POST = writeRoute('activos:write', CreateActivoBodySchema, async ({ db, key, body }) => {
    const { created, data } = await createActivo(db, key.tenantId, key.name, body);
    return { status: created ? 201 : 200, body: data };
});
