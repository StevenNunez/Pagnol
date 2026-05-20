import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendPushNotification, type PushPayload } from '@/lib/web-push';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { tenantId, payload, targetUserIds } = await req.json() as {
      tenantId: string;
      payload: PushPayload;
      targetUserIds?: string[];
    };

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
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
