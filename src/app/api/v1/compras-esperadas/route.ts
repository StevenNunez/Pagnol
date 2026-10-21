import { listRoute, writeRoute } from '@/lib/api/handler';
import { createCompra, listCompras } from '@/lib/api/queries';
import { ComprasQuerySchema, CreateCompraBodySchema } from '@/lib/api/schemas';

export const GET = listRoute('compras:read', ComprasQuerySchema, ({ db, key, params }) =>
    listCompras(db, key.tenantId, params),
);

// Anuncia una compra que viene en camino. 201 = anunciada; 200 = ya existía con esa external_ref.
export const POST = writeRoute('compras:write', CreateCompraBodySchema, async ({ db, key, body }) => {
    const { created, data } = await createCompra(db, key.tenantId, key.name, body);
    return { status: created ? 201 : 200, body: data };
});
