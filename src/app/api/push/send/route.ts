import { NextRequest, NextResponse } from 'next/server';
import { sendPushNotification, type PushPayload } from '@/lib/web-push';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

const supabase = getSupabaseAdmin();

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

    let query = supabase
      .from('push_subscriptions')
      .select('*')
      .eq('tenant_id', tenantId);

    if (targetUserIds?.length) {
      query = query.in('user_id', targetUserIds);
    }

    const { data: subscriptions, error } = await query;
    if (error) throw error;

    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ sent: 0, message: 'Sin suscripciones registradas' });
    }

    const expiredEndpoints: string[] = [];
    let sent = 0;

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const ok = await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        if (ok) {
          sent++;
        } else {
          expiredEndpoints.push(sub.endpoint);
        }
      })
    );

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('endpoint', expiredEndpoints);
    }

    return NextResponse.json({ sent, expired: expiredEndpoints.length });
  } catch (err: any) {
    console.error('Push send route error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
