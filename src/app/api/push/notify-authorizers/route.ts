import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { sendPushToUsers, getUserIdsWithPermission, narrowAuthorizers } from '@/lib/push-notify';
import type { Permission } from '@/modules/core/lib/permissions';

// Dispara un push a los Administradores de Contrato (y demás autorizadores) del
// tenant cuando terreno crea una solicitud que requiere autorización. Se llama
// desde las mutaciones add* (fire-and-forget) solo si NO entró pre-autorizada.

const PERMISSION_BY_TYPE: Record<string, Permission> = {
  material: 'material_requests:authorize',
  purchase: 'purchase_requests:authorize',
  rental: 'rentals:authorize',
  // RFC-006 F1: lo que primero revisa el Jefe de Operaciones.
  purchase_review: 'purchase_requests:review_operations',
  rental_review: 'rentals:review_operations',
  // RFC-006 F2: compra sobre el monto del ADC.
  proposal_gerente: 'approvals:sign_gerente',
};

const LABEL_BY_TYPE: Record<string, string> = {
  material: 'material',
  purchase: 'compra',
  rental: 'arriendo',
  purchase_review: 'compra',
  rental_review: 'arriendo',
  proposal_gerente: 'compra',
};

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    const { tenantId: bodyTenantId, type, code, requesterName } = (await req.json()) as {
      tenantId?: string;
      type: 'material' | 'purchase' | 'rental' | 'purchase_review' | 'rental_review' | 'proposal_gerente';
      code?: string;
      requesterName?: string;
    };

    const tenantId = resolveTenant(ctx, bodyTenantId);
    const permission = PERMISSION_BY_TYPE[type];
    if (!tenantId || !permission) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 });
    }

    // Destinatarios = autorizadores del tenant, menos el propio creador.
    let userIds = (await getUserIdsWithPermission(tenantId, permission)).filter((id) => id !== ctx.userId);
    // RFC-006 F6: sólo el ADC de ese contrato (o el Gerente, si el retiro pasa el tope).
    if (type === 'material' || type === 'purchase' || type === 'rental') {
      userIds = await narrowAuthorizers(tenantId, type, code, userIds);
    }
    if (userIds.length === 0) return NextResponse.json({ sent: 0, message: 'Sin autorizadores suscritos' });

    const label = LABEL_BY_TYPE[type];
    const isReview = type.endsWith('_review');
    const isProposal = type === 'proposal_gerente';
    const result = await sendPushToUsers(tenantId, userIds, {
      title: isProposal ? 'Compra por firmar' : isReview ? 'Nueva solicitud por revisar' : 'Nueva solicitud por autorizar',
      body: isProposal
        ? `${requesterName || 'Abastecimiento'} envió una compra${code ? ` (${code})` : ''} sobre el monto del ADC: requiere tu firma.`
        : isReview
        ? `${requesterName || 'Terreno'} pidió un ${label === 'compra' ? 'requerimiento de compra' : 'arriendo'}${code ? ` (${code})` : ''}: revísalo antes de que pase al ADC.`
        : `${requesterName || 'Terreno'} tiene una solicitud de ${label}${code ? ` (${code})` : ''} que requiere tu autorización.`,
      url: '/dashboard/authorizations',
      tag: 'adc-authorization',
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error('notify-authorizers error:', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
