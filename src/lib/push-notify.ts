import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { sendPushNotification, type PushPayload } from './web-push';
import { ROLES, type Permission } from '@/modules/core/lib/permissions';
import type { UserRole } from '@/modules/core/lib/data';

const admin = getSupabaseAdmin();

/**
 * Envía un push a las suscripciones de un tenant (opcionalmente acotado a
 * ciertos usuarios), limpiando las suscripciones expiradas (410/404).
 * Centraliza el bucle que antes vivía inline en /api/push/send.
 */
export async function sendPushToUsers(
  tenantId: string,
  userIds: string[] | null,
  payload: PushPayload,
): Promise<{ sent: number; expired: number }> {
  let query = admin.from('push_subscriptions').select('*').eq('tenant_id', tenantId);
  if (userIds && userIds.length) query = query.in('user_id', userIds);

  const { data: subscriptions, error } = await query;
  if (error) throw error;
  if (!subscriptions || subscriptions.length === 0) return { sent: 0, expired: 0 };

  const expiredEndpoints: string[] = [];
  let sent = 0;

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const ok = await sendPushNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      if (ok) sent++;
      else expiredEndpoints.push(sub.endpoint);
    }),
  );

  if (expiredEndpoints.length > 0) {
    await admin.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
  }

  return { sent, expired: expiredEndpoints.length };
}

// Roles que pueden autorizar por bypass de control total (ver can()/userCan()),
// aunque NO tengan el permiso listado explícitamente en ROLES.
const BYPASS_ROLES: UserRole[] = ['administrador', 'soporte-pagnol', 'super-admin'];

/** Roles cuyo set por defecto incluye el permiso, más los de bypass. */
function rolesWithPermission(permission: Permission): UserRole[] {
  const roles = (Object.keys(ROLES) as UserRole[]).filter((r) =>
    ROLES[r].permissions.includes(permission),
  );
  return Array.from(new Set([...roles, ...BYPASS_ROLES]));
}

/**
 * IDs de los usuarios de un tenant que pueden ejercer un permiso, ya sea por su
 * rol (defaults o bypass) o por un permiso otorgado individualmente.
 */
export async function getUserIdsWithPermission(
  tenantId: string,
  permission: Permission,
): Promise<string[]> {
  const roles = rolesWithPermission(permission);
  const { data, error } = await admin
    .from('profiles')
    .select('id, role, granted_permissions')
    .eq('tenant_id', tenantId);
  if (error || !data) return [];

  return data
    .filter((p: any) => roles.includes(p.role) || (p.granted_permissions ?? []).includes(permission))
    .map((p: any) => p.id);
}

const REQUEST_TABLE = {
  material: 'material_requests',
  purchase: 'purchase_requests',
  rental: 'rental_requests',
} as const;

/**
 * RFC-006 F6 — Con la firma por monto encendida, el aviso de "por autorizar" va
 * sólo a quien le toca: el ADC del contrato del pedido (no a todos los ADC), y en
 * un retiro del pañol sobre el tope, al Gerente General en vez del ADC. Los demás
 * autorizadores (administración, director de faena) se mantienen. Sin la
 * exigencia, o si no se encuentra el pedido, la lista queda como venía.
 */
export async function narrowAuthorizers(
  tenantId: string,
  type: keyof typeof REQUEST_TABLE,
  code: string | undefined,
  userIds: string[],
): Promise<string[]> {
  if (!code || userIds.length === 0) return userIds;
  const { data: tenant } = await admin.from('tenants').select('approval_settings').eq('id', tenantId).single();
  const settings = (tenant?.approval_settings ?? {}) as { enforced?: boolean; adcMaxGross?: number; vatRate?: number };
  if (!settings.enforced) return userIds;

  const { data: req } = await admin
    .from(REQUEST_TABLE[type])
    .select(type === 'material' ? 'contract_id, items' : 'contract_id')
    .eq('tenant_id', tenantId)
    .eq('internal_code', code)
    .maybeSingle();
  if (!req) return userIds;
  const row = req as unknown as { contract_id: string | null; items?: unknown };

  const { data: contract } = row.contract_id
    ? await admin.from('contracts').select('adc_user_id').eq('id', row.contract_id).maybeSingle()
    : { data: null };
  const contractAdc = (contract as { adc_user_id?: string | null } | null)?.adc_user_id ?? null;

  let gerenteTier = false;
  if (type === 'material') {
    const { data: net } = await admin.rpc('withdrawal_value_net', { p_items: row.items ?? [], p_tenant: tenantId });
    const gross = Math.round(Number(net || 0) * (1 + (settings.vatRate ?? 0.19)));
    gerenteTier = gross > (settings.adcMaxGross ?? 500000);
  }

  const { data: profiles } = await admin.from('profiles').select('id, role').in('id', userIds);
  const roleOf = new Map((profiles ?? []).map((p: { id: string; role: string }) => [p.id, p.role]));
  return userIds.filter((id) => {
    const role = roleOf.get(id);
    if (role === 'adc') return !gerenteTier && id === contractAdc;
    if (role === 'gerente-general') return type !== 'material' || gerenteTier;
    return true;
  });
}
