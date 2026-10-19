import { z } from 'zod';
import { listRoute, writeRoute } from '@/lib/api/handler';
import { createWebhook, listWebhooks } from '@/lib/api/queries';
import { CreateWebhookBodySchema } from '@/lib/api/schemas';

export const GET = listRoute('webhooks:manage', z.object({}), ({ db, key }) =>
    listWebhooks(db, key.tenantId),
);

// El secreto de firma viaja SOLO en esta respuesta (y en su repetición idempotente, 24 h).
export const POST = writeRoute('webhooks:manage', CreateWebhookBodySchema, async ({ db, key, body }) => ({
    status: 201,
    body: await createWebhook(db, key.tenantId, key.apiKeyId, body),
}));
