import { NextResponse } from 'next/server';
import { requireAuth } from '@/modules/core/lib/api-auth';

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request, { permission: 'users:change_password' });
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        const { userId, newPassword } = await request.json();

        if (!userId || !newPassword) {
            return NextResponse.json({ error: 'Datos incompletos: se requiere userId y newPassword.' }, { status: 400 });
        }

        if (newPassword.length < 6) {
            return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres.' }, { status: 400 });
        }

        const admin = ctx.admin;

        // El usuario objetivo debe pertenecer al mismo tenant del administrador.
        // Un administrador no puede cambiar la contraseña de un super-admin.
        const { data: target } = await admin
            .from('profiles')
            .select('tenant_id, role')
            .eq('id', userId)
            .single();

        if (!target) {
            return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
        }
        if (!ctx.isSuperAdmin && (target.tenant_id !== ctx.tenantId || target.role === 'super-admin')) {
            return NextResponse.json({ error: 'No autorizado para modificar este usuario.' }, { status: 403 });
        }

        const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });

        if (error) {
            console.error('[users/change-password] updateUserById:', error.message);
            return NextResponse.json({ error: 'No se pudo actualizar la contraseña.' }, { status: 400 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[users/change-password]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
