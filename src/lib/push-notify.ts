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
