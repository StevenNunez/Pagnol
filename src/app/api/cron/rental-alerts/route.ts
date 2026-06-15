import { NextRequest, NextResponse } from 'next/server';
import { sendPushNotification, type PushPayload } from '@/lib/web-push';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

const supabase = getSupabaseAdmin();

// Cron diario (ver vercel.json). Recorre por tenant los pagos de arriendo vencidos
// o que vencen en las próximas 48h y los contratos que terminan en los próximos 7
// días, y envía una notificación push resumida a las suscripciones de ese tenant.

export async function GET(req: NextRequest) {
  // Protección: Vercel Cron envía `Authorization: Bearer <CRON_SECRET>`.
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const in2days = new Date(today); in2days.setDate(in2days.getDate() + 2);
    const in7days = new Date(today); in7days.setDate(in7days.getDate() + 7);

    // Pagos no pagados que vencen hasta dentro de 2 días (incluye atrasados).
    const { data: duePayments, error: pErr } = await supabase
      .from('rental_payments')
      .select('tenant_id, due_date, amount, status')
      .neq('status', 'paid')
      .lte('due_date', iso(in2days));
    if (pErr) throw pErr;

    // Contratos activos que terminan dentro de 7 días.
    const { data: endingContracts, error: cErr } = await supabase
      .from('rental_contracts')
      .select('tenant_id, title, end_date, status')
      .eq('status', 'active')
      .not('end_date', 'is', null)
      .gte('end_date', iso(today))
      .lte('end_date', iso(in7days));
    if (cErr) throw cErr;

    // Agrupar conteos por tenant.
    const byTenant = new Map<string, { overdue: number; soon: number; ending: number }>();
    const bump = (t: string, key: 'overdue' | 'soon' | 'ending') => {
      const cur = byTenant.get(t) || { overdue: 0, soon: 0, ending: 0 };
      cur[key] += 1;
      byTenant.set(t, cur);
    };

    for (const p of duePayments || []) {
      if (!p.tenant_id) continue;
      const overdue = new Date(p.due_date) < today;
      bump(p.tenant_id, overdue ? 'overdue' : 'soon');
    }
    for (const c of endingContracts || []) {
      if (c.tenant_id) bump(c.tenant_id, 'ending');
    }

    let tenantsNotified = 0;
    let totalSent = 0;

    for (const [tenantId, counts] of byTenant.entries()) {
      const parts: string[] = [];
      if (counts.overdue) parts.push(`${counts.overdue} pago(s) vencido(s)`);
      if (counts.soon) parts.push(`${counts.soon} pago(s) por vencer`);
      if (counts.ending) parts.push(`${counts.ending} contrato(s) por terminar`);
      if (parts.length === 0) continue;

      const payload: PushPayload = {
        title: 'Alertas de Arriendos',
        body: parts.join(' · '),
        url: '/dashboard/rentals',
        tag: 'rental-alerts',
        requireInteraction: false,
      };

      const { data: subs, error: sErr } = await supabase
        .from('push_subscriptions')
        .select('*')
        .eq('tenant_id', tenantId);
      if (sErr || !subs?.length) continue;

      const expired: string[] = [];
      await Promise.allSettled(
        subs.map(async (sub) => {
          const ok = await sendPushNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          );
          if (ok) totalSent++;
          else expired.push(sub.endpoint);
        }),
      );
      if (expired.length) {
        await supabase.from('push_subscriptions').delete().in('endpoint', expired);
      }
      tenantsNotified++;
    }

    return NextResponse.json({ ok: true, tenantsNotified, totalSent });
  } catch (err: any) {
    console.error('rental-alerts cron error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
