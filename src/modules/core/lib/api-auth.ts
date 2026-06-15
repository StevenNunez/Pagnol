import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { ROLES, type Permission } from '@/modules/core/lib/permissions';
import type { UserRole } from '@/modules/core/lib/data';

type Admin = ReturnType<typeof getSupabaseAdmin>;

export interface AuthContext {
    userId: string;
    role: string;
    tenantId: string | null;
    isSuperAdmin: boolean;
    grantedPermissions: string[];
    admin: Admin;
}

/**
 * Replica server-side la lógica de `can()` del cliente (AuthProvider):
 * super-admin → granted_permissions → permisos por defecto del rol (ROLES).
 */
export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
    if (ctx.isSuperAdmin) return true;
    if (ctx.grantedPermissions.includes(permission)) return true;
    const rolePerms = ROLES[ctx.role as UserRole]?.permissions;
    return rolePerms ? rolePerms.includes(permission) : false;
}

export type RequireAuthResult =
    | { ok: true; ctx: AuthContext }
    | { ok: false; response: NextResponse };

/**
 * Valida el Bearer token de la request contra Supabase Auth y carga el perfil
 * del llamante (tenant_id, role). Úsalo en TODA ruta server que use el admin
 * client (service role) para evitar que el endpoint quede abierto.
 *
 * @param opts.permission  Si se indica, el llamante debe tener este permiso
 *                         (mismo criterio que `can()` en el cliente).
 * @param opts.roles       Alternativa por rol. super-admin siempre pasa.
 */
export async function requireAuth(
    req: Request,
    opts?: { permission?: Permission; roles?: string[] }
): Promise<RequireAuthResult> {
    const token = req.headers.get('authorization')?.replace('Bearer ', '').trim();
    if (!token) {
        return { ok: false, response: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
    }

    const admin = getSupabaseAdmin();
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) {
        return { ok: false, response: NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }) };
    }

    const { data: profile } = await admin
        .from('profiles')
        .select('tenant_id, role, granted_permissions')
        .eq('id', user.id)
        .single();

    if (!profile) {
        return { ok: false, response: NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 }) };
    }

    const isSuperAdmin = profile.role === 'super-admin';
    const ctx: AuthContext = {
        userId: user.id,
        role: profile.role,
        tenantId: profile.tenant_id,
        isSuperAdmin,
        grantedPermissions: profile.granted_permissions ?? [],
        admin,
    };

    if (opts?.roles && !isSuperAdmin && !opts.roles.includes(profile.role)) {
        return { ok: false, response: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
    }

    if (opts?.permission && !hasPermission(ctx, opts.permission)) {
        return { ok: false, response: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) };
    }

    return { ok: true, ctx };
}

/**
 * Resuelve el tenant sobre el que opera la request.
 * - Usuarios normales: SIEMPRE su propio tenant (se ignora cualquier tenantId del body).
 * - Super-admin: puede operar sobre el tenant indicado (selección cross-tenant por diseño).
 */
export function resolveTenant(ctx: AuthContext, requestedTenantId?: string | null): string | null {
    if (ctx.isSuperAdmin) return requestedTenantId ?? ctx.tenantId;
    return ctx.tenantId;
}
