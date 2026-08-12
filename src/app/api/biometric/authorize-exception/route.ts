import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, hasPermission, type AuthContext } from '@/modules/core/lib/api-auth';
import { ROLES } from '@/modules/core/lib/permissions';
import type { UserRole } from '@/modules/core/lib/data';

/**
 * Autorización PRESENCIAL de una excepción biométrica: un ADC o Administrador
 * teclea sus credenciales en el equipo del pañol para dejar salir un activo sin
 * verificación facial.
 *
 * Por qué existe esta ruta en vez de resolverlo en el cliente: validar la clave
 * del autorizador con `signInWithPassword` del cliente compartido **cerraría la
 * sesión del pañolero** y lo dejaría fuera a mitad de la entrega. Acá se valida
 * contra un cliente efímero y aislado, sin tocar la sesión activa del navegador.
 *
 * La contraseña se usa sólo para verificar y no se persiste ni se registra.
 */

/** Quién puede autorizar que un activo salga sin verificación biométrica. */
const PERMISO_AUTORIZADOR = 'material_requests:authorize' as const;
const ROLES_AUTORIZADORES = ['administrador', 'adc', 'super-admin', 'soporte-pagnol'];

function puedeAutorizar(role: string, grantedPermissions: string[]): boolean {
    if (ROLES_AUTORIZADORES.includes(role)) return true;
    if (grantedPermissions.includes(PERMISO_AUTORIZADOR)) return true;
    return ROLES[role as UserRole]?.permissions?.includes(PERMISO_AUTORIZADOR) ?? false;
}

export async function POST(req: Request) {
    // 1. Quien PIDE la autorización debe ser un usuario válido del tenant. Sin
    //    esto el endpoint sería un oráculo para probar contraseñas ajenas.
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const ctx: AuthContext = auth.ctx;

    let body: { email?: string; password?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
    }

    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
        return NextResponse.json({ error: 'Faltan credenciales del autorizador' }, { status: 400 });
    }

    // 2. Validar las credenciales del AUTORIZADOR en un cliente aislado: no
    //    comparte almacenamiento ni sesión con nadie, así que no desplaza la del
    //    pañolero ni deja rastro de sesión en el servidor.
    const efimero = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: signIn, error: signInError } = await efimero.auth.signInWithPassword({ email, password });
    if (signInError || !signIn?.user) {
        // Mensaje deliberadamente vago: no confirmar si el correo existe.
        return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
    }

    try {
        // 3. El autorizador tiene que ser del MISMO tenant y tener el permiso.
        const { data: perfil } = await ctx.admin
            .from('profiles')
            .select('id, name, role, tenant_id, granted_permissions')
            .eq('id', signIn.user.id)
            .single();

        if (!perfil) {
            return NextResponse.json({ error: 'El autorizador no tiene perfil' }, { status: 403 });
        }
        if (perfil.role !== 'super-admin' && perfil.tenant_id !== ctx.tenantId) {
            return NextResponse.json({ error: 'El autorizador pertenece a otra empresa' }, { status: 403 });
        }
        if (!puedeAutorizar(perfil.role, perfil.granted_permissions ?? [])) {
            return NextResponse.json(
                { error: 'Esa persona no puede autorizar retiros sin biometría. Debe ser ADC o Administrador.' },
                { status: 403 },
            );
        }
        // 4. Nadie se autoriza a sí mismo: la excepción existe para que un
        //    segundo par de ojos se haga responsable de la salida del activo.
        if (perfil.id === ctx.userId) {
            return NextResponse.json(
                { error: 'La excepción debe autorizarla otra persona, no quien opera el pañol.' },
                { status: 403 },
            );
        }

        return NextResponse.json({
            ok: true,
            authorizer: { id: perfil.id, name: perfil.name, role: perfil.role },
        });
    } finally {
        // Cerrar la sesión efímera pase lo que pase: no debe quedar viva.
        await efimero.auth.signOut().catch(() => { });
    }
}
