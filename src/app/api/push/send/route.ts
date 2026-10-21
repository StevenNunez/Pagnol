import { NextRequest, NextResponse } from 'next/server';
import { sendPushToUsers } from '@/lib/push-notify';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { checkRateLimit } from '@/modules/core/lib/rate-limit';
import { sanitizePushPayload, cleanTargetIds } from '@/lib/push-payload';

// Push genérico a personas puntuales de la propia empresa. Lo usan las pantallas para avisos que no
// tienen ruta propia (la prueba de «notificaciones», el aviso de un retiro por revisar, las firmas).
//
// Como el texto y los destinatarios los manda el cliente, esta ruta no puede ser un megáfono:
//  · el enlace tiene que ser una ruta DENTRO de la app (antes aceptaba cualquier URL: un anzuelo de
//    phishing que llega «de Pagnol»), y el texto se recorta y se limpia;
//  · hay que nombrar destinatarios (antes, sin lista, avisaba a TODA la empresa), con tope;
//  · sólo se puede avisar a otras personas si el rol opera el pañol, compras o las firmas — los roles de
//    terreno (operador, guardia, contratista) pueden mandarse una prueba a sí mismos, nada más;
//  · tope por usuario y hora.
// Para avisos con destinatarios y texto decididos por el servidor, ver `notify-withdrawal`.

const FIELD_ROLES = ['operador', 'guardia', 'contratista'];
const MAX_PER_HOUR = 40;

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const body = (await req.json().catch(() => ({}))) as { tenantId?: string; payload?: unknown; targetUserIds?: unknown };

    // Solo se puede notificar dentro del propio tenant (super-admin cross-tenant).
    const tenantId = resolveTenant(ctx, body.tenantId);
    const payload = sanitizePushPayload(body.payload);
    const targets = cleanTargetIds(body.targetUserIds);

    if (!tenantId || !payload || targets.length === 0) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    const toOthers = targets.some((id) => id !== ctx.userId);
    if (toOthers && FIELD_ROLES.includes(ctx.role) && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Tu rol sólo puede mandarse avisos a sí mismo.' }, { status: 403 });
    }

    if (!(await checkRateLimit(`push-send:${ctx.userId}`, MAX_PER_HOUR, 3600))) {
      return NextResponse.json({ error: 'Demasiados avisos. Intenta más tarde.' }, { status: 429 });
    }

    const result = await sendPushToUsers(tenantId, targets, payload);
    if (result.sent === 0 && result.expired === 0) {
      return NextResponse.json({ sent: 0, message: 'Sin suscripciones registradas' });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('Push send route error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
