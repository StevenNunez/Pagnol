import { deleteRoute } from '@/lib/api/handler';
import { deleteWebhook } from '@/lib/api/queries';

export const DELETE = deleteRoute('webhooks:manage', ({ db, key, params }) =>
    deleteWebhook(db, key.tenantId, params.id),
);
