import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

const supabase = getSupabaseAdmin();

export async function POST(req: NextRequest) {
  try {
    const { subscription, userId, tenantId } = await req.json();

    if (!subscription?.endpoint || !userId || !tenantId) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: userId,
        tenant_id: tenantId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'endpoint' });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Push subscribe error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json();
    if (!endpoint) return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 });

    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Push unsubscribe error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
