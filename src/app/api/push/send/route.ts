import { NextRequest, NextResponse } from 'next/server';
import { type PushPayload } from '@/lib/web-push';
import { sendPushToUsers } from '@/lib/push-notify';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { tenantId: bodyTenantId, payload, targetUserIds } = await req.json() as {
      tenantId: string;
      payload: PushPayload;
      targetUserIds?: string[];
    };

    // Solo se puede notificar dentro del propio tenant (super-admin cross-tenant).
    const tenantId = resolveTenant(ctx, bodyTenantId);

    if (!tenantId || !payload?.title) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    const result = await sendPushToUsers(tenantId, targetUserIds ?? null, payload);
    if (result.sent === 0 && result.expired === 0) {
      return NextResponse.json({ sent: 0, message: 'Sin suscripciones registradas' });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Push send route error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
