import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { sendPushToUsers, getUserIdsWithPermission } from '@/lib/push-notify';
import type { Permission } from '@/modules/core/lib/permissions';

// Dispara un push a los Administradores de Contrato (y demás autorizadores) del
// tenant cuando terreno crea una solicitud que requiere autorización. Se llama
// desde las mutaciones add* (fire-and-forget) solo si NO entró pre-autorizada.

const PERMISSION_BY_TYPE: Record<string, Permission> = {
  material: 'material_requests:authorize',
  purchase: 'purchase_requests:authorize',
  rental: 'rentals:authorize',
};

const LABEL_BY_TYPE: Record<string, string> = {
  material: 'material',
  purchase: 'compra',
  rental: 'arriendo',
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { tenantId: bodyTenantId, type, code, requesterName } = (await req.json()) as {
      tenantId?: string;
      type: 'material' | 'purchase' | 'rental';
      code?: string;
      requesterName?: string;
    };

    const tenantId = resolveTenant(ctx, bodyTenantId);
    const permission = PERMISSION_BY_TYPE[type];
    if (!tenantId || !permission) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    // Destinatarios = autorizadores del tenant, menos el propio creador.
    const userIds = (await getUserIdsWithPermission(tenantId, permission)).filter((id) => id !== ctx.userId);
    if (userIds.length === 0) return NextResponse.json({ sent: 0, message: 'Sin autorizadores suscritos' });

    const label = LABEL_BY_TYPE[type];
    const result = await sendPushToUsers(tenantId, userIds, {
      title: 'Nueva solicitud por autorizar',
      body: `${requesterName || 'Terreno'} creó una solicitud de ${label}${code ? ` (${code})` : ''} que requiere tu autorización.`,
      url: '/dashboard/authorizations',
      tag: 'adc-authorization',
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('notify-authorizers error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
