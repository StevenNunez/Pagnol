import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';
import { sendPushToUsers, getUserIdsWithPermission } from '@/lib/push-notify';
import { checkRateLimit } from '@/modules/core/lib/rate-limit';
import { highestClassOf, permissionsToApprove } from '@/modules/data/mutations/requestClassMath';
import type { Permission } from '@/modules/core/lib/permissions';

// Avisos del recorrido de un retiro del pañol:
//   authorized → el ADC lo autorizó: le toca al pañol (a quien puede aprobar esa clase);
//   approved   → el pañol aprobó el despacho: el solicitante (o quien retira) ya puede ir;
//   cancelled  → se anuló el despacho aprobado: que nadie vaya a buscarlo.
//
// El cliente sólo manda el id del retiro y el evento. A quién avisar y qué decir lo decide el
// servidor leyendo el retiro, y sólo si el retiro está de verdad en el estado del evento: no sirve
// para mandar avisos a gusto (para eso existía `/api/push/send`, que acepta cualquier mensaje).

type Event = 'authorized' | 'approved' | 'cancelled';
const EVENTS: Event[] = ['authorized', 'approved', 'cancelled'];

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const admin = ctx.admin;

    const { event, requestId } = (await req.json().catch(() => ({}))) as { event?: Event; requestId?: string };
    if (!event || !EVENTS.includes(event) || !requestId || typeof requestId !== 'string') {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    const { data: r } = await admin
      .from('material_requests')
      .select('id, tenant_id, internal_code, status, adc_authorized_at, delivery_date, items, supervisor_id, supervisor_name, delivery_mode, beneficiary_id')
      .eq('id', requestId)
      .maybeSingle();
    if (!r) return NextResponse.json({ error: 'No se encontró el retiro' }, { status: 404 });
    if (r.tenant_id !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    // Sólo se avisa de lo que de verdad pasó: un retiro que no está en el estado del evento no avisa.
    const inState =
      event === 'authorized' ? r.status === 'pending' && !!r.adc_authorized_at
      : event === 'approved' ? r.status === 'approved' && !r.delivery_date
      : r.status === 'pending' && !!r.adc_authorized_at;
    if (!inState) return NextResponse.json({ sent: 0, message: 'El retiro no está en el estado del aviso' });

    // Hasta 2 avisos por retiro y evento por hora (un reintento legítimo pasa): un doble clic no llena de avisos.
    if (!(await checkRateLimit(`notify-withdrawal:${r.id}:${event}`, 2, 3600))) {
      return NextResponse.json({ sent: 0, message: 'Aviso ya enviado' });
    }

    const code = r.internal_code || r.id.slice(0, 8).toUpperCase();
    let userIds: string[] = [];
    let payload: { title: string; body: string; url: string; tag: string };

    if (event === 'authorized') {
      // La clase REAL, de los materiales: la guardada puede venir mal de antes.
      const ids = ((r.items ?? []) as { materialId: string }[]).map((i) => i.materialId);
      const { data: mats } = ids.length ? await admin.from('materials').select('id, criticality').in('id', ids) : { data: [] };
      const cls = highestClassOf((mats ?? []).map((m: { criticality: string | null }) => m.criticality));
      const sets = await Promise.all(permissionsToApprove(cls).map((p) => getUserIdsWithPermission(r.tenant_id, p as Permission)));
      userIds = [...new Set(sets.flat())].filter((id) => id !== ctx.userId);
      payload = {
        title: 'Retiro por aprobar',
        body: `${r.supervisor_name || 'Un solicitante'} tiene el retiro ${code} autorizado: falta que lo apruebes en el pañol.`,
        url: '/dashboard/pagnol/solicitudes?paso=por-aprobar',
        tag: `withdrawal-authorized-${r.id}`,
      };
    } else {
      // Quién retira: el beneficiario si es entrega dirigida; si no, el solicitante.
      const receiver = r.delivery_mode === 'directed' && r.beneficiary_id ? r.beneficiary_id : r.supervisor_id;
      userIds = [...new Set([receiver, r.supervisor_id].filter(Boolean) as string[])].filter((id) => id !== ctx.userId);
      payload = event === 'approved'
        ? {
            title: 'Tu retiro está listo',
            body: `El retiro ${code} fue aprobado: pasa por el pañol a buscarlo.`,
            url: '/dashboard/supervisor/request',
            tag: `withdrawal-approved-${r.id}`,
          }
        : {
            title: 'Despacho anulado',
            body: `El despacho del retiro ${code} se anuló: no lo pases a buscar todavía, vuelve a revisión.`,
            url: '/dashboard/supervisor/request',
            tag: `withdrawal-cancelled-${r.id}`,
          };
    }

    if (userIds.length === 0) return NextResponse.json({ sent: 0, message: 'Sin destinatarios' });
    const result = await sendPushToUsers(r.tenant_id, userIds, payload);
    return NextResponse.json(result);
  } catch (err) {
    console.error('notify-withdrawal error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
