import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';

// La identidad (user_id/tenant_id) se deriva SIEMPRE de la sesión del llamante,
// nunca del body: antes un atacante podía registrar su dispositivo como
// suscripción de cualquier usuario y recibir sus notificaciones.

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { subscription } = await req.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }
    if (!ctx.tenantId) {
      return NextResponse.json({ error: 'Perfil sin tenant' }, { status: 403 });
    }

    const { error } = await ctx.admin
      .from('push_subscriptions')
      .upsert({
        user_id: ctx.userId,
        tenant_id: ctx.tenantId,
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
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { endpoint } = await req.json();
    if (!endpoint) return NextResponse.json({ error: 'Falta endpoint' }, { status: 400 });

    // Solo puede borrar sus propias suscripciones (endpoint + user_id).
    await ctx.admin
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', ctx.userId);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Push unsubscribe error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
