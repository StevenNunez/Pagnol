import { deleteRoute, writeRoute } from '@/lib/api/handler';
import { deleteWebhook, patchWebhook } from '@/lib/api/queries';
import { PatchWebhookBodySchema } from '@/lib/api/schemas';

// Cambiar eventos, URL o pausar SIN recrear la suscripción: el secreto de firma se conserva.
export const PATCH = writeRoute('webhooks:manage', PatchWebhookBodySchema, async ({ db, key, params, body }) => ({
    status: 200,
    body: await patchWebhook(db, key.tenantId, params.id!, body),
}), { idParam: true });

export const DELETE = deleteRoute('webhooks:manage', ({ db, key, params }) =>
    deleteWebhook(db, key.tenantId, params.id),
);
