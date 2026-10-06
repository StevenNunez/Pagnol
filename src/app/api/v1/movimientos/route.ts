import { writeRoute } from '@/lib/api/handler';
import { createMovimiento } from '@/lib/api/queries';
import { CreateMovimientoBodySchema } from '@/lib/api/schemas';

// Ingreso de stock de un consumible al recepcionarlo, o reverso de un ingreso.
// 201 = registrado; 200 = ya existía con esa external_ref.
export const POST = writeRoute('stock:write', CreateMovimientoBodySchema, async ({ db, key, body }) => {
    const { created, data } = await createMovimiento(db, key.tenantId, key.name, body);
    return { status: created ? 201 : 200, body: data };
});
