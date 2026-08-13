import { NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/modules/core/lib/api-auth';

/**
 * Sesiones de enrolamiento por QR, operadas desde el servidor.
 *
 * POR QUÉ: el asistente de enrolamiento creaba la sesión y hacía polling
 * directamente contra `enrollment_sessions` con el cliente anon. Esa tabla sigue
 * el patrón multi-tenant estándar —cualquier miembro del tenant lee todas sus
 * filas— y guarda `biometric_template` junto a `kyc_id_front` / `kyc_id_back`,
 * o sea el descriptor facial Y LAS FOTOS DE LA CÉDULA. Era la segunda puerta al
 * mismo dato que cierra la bóveda biométrica, y no estaba anotada en el backlog.
 *
 * Con estas dos rutas el navegador del administrador sólo necesita saber si el
 * trabajador ya terminó en su móvil (`status`). El descriptor y los documentos
 * viajan del móvil al servidor y del servidor a su destino final
 * (`biometric_templates` y `profile_documents`), sin pasar nunca por acá.
 *
 * La migración de corte (`20260816010000`) le quita el acceso a `authenticated`,
 * así que después de aplicarla ésta es la única vía.
 */

/** Mismo criterio que crear y enrolar personal. */
function puedeEnrolar(ctx: Parameters<typeof hasPermission>[0]): boolean {
    return hasPermission(ctx, 'users:create') || hasPermission(ctx, 'pagnol:enroll_personal');
}

/** Crea la sesión que el trabajador completará desde su móvil. */
export async function POST(request: Request) {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!puedeEnrolar(ctx)) {
        return NextResponse.json({ error: 'No autorizado para enrolar personal.' }, { status: 403 });
    }

    let body: Record<string, any>;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
        return NextResponse.json({ error: 'Falta el token de la sesión.' }, { status: 400 });
    }

    // El tenant sale del perfil de quien enrola, nunca del cuerpo: si viniera del
    // body, un administrador podría sembrar sesiones en otra empresa.
    const { error } = await ctx.admin
        .from('enrollment_sessions')
        .upsert({
            token,
            tenant_id: ctx.tenantId,
            user_id: body.userId || null,
            admin_id: ctx.userId,
            name: body.name || null,
            email: body.email || null,
            rut: body.rut || null,
            role: body.role || null,
            internal_id: body.internalId || null,
            status: 'pending',
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        }, { onConflict: 'token' });

    if (error) {
        console.error('[enroll/session] crear:', error.message);
        return NextResponse.json({ error: 'No se pudo crear la sesión de enrolamiento.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}

/**
 * Estado de la sesión — y SÓLO el estado.
 *
 * Antes esta consulta devolvía `status, biometric_template, kyc_face_image,
 * kyc_id_front, kyc_id_back`. Devolver el estado a secas es todo lo que el
 * asistente necesita para avanzar de paso.
 */
export async function GET(request: Request) {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;

    if (!puedeEnrolar(ctx)) {
        return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const token = new URL(request.url).searchParams.get('token')?.trim();
    if (!token) {
        return NextResponse.json({ error: 'Falta el token.' }, { status: 400 });
    }

    let q = ctx.admin.from('enrollment_sessions').select('status').eq('token', token);
    if (!ctx.isSuperAdmin) q = q.eq('tenant_id', ctx.tenantId);

    const { data, error } = await q.maybeSingle();
    if (error) {
        console.error('[enroll/session] estado:', error.message);
        return NextResponse.json({ error: 'No se pudo consultar la sesión.' }, { status: 500 });
    }

    return NextResponse.json({ status: data?.status ?? null });
}
