import { NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/modules/core/lib/api-auth';

/**
 * Actualiza SOLO campos de ficha RRHH de un usuario existente.
 *
 * Va por service role (salta RLS) para que el rol `recursos-humanos` —que NO es
 * `is_tenant_admin()` y por tanto no puede escribir profiles vía cliente anon— pueda
 * mantener la ficha. Deliberadamente NO expone rol/sueldo/AFP/salud ni los documentos
 * KYC: solo el conjunto "seguro" de RRHH.
 *
 * Autoriza con `hr_employees:edit` (o `users:edit` / super-admin).
 */
// Mapa camelCase (entrada) → columna snake_case. Solo campos "seguros" de RRHH.
const HR_FIELD_MAP: Record<string, string> = {
    cargo: 'cargo',
    phone: 'phone',
    address: 'address',
    birthDate: 'birth_date',
    emergencyContactName: 'emergency_contact_name',
    emergencyContactPhone: 'emergency_contact_phone',
    employmentStatus: 'employment_status',
};

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        if (!hasPermission(ctx, 'hr_employees:edit') && !hasPermission(ctx, 'users:edit')) {
            return NextResponse.json({ error: 'No autorizado para editar fichas de RRHH.' }, { status: 403 });
        }

        const body = await request.json();
        const { userId } = body;
        if (!userId) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = ctx.admin;

        // El usuario debe pertenecer al tenant del llamante (salvo super-admin).
        const { data: target, error: targetError } = await admin
            .from('profiles')
            .select('id, tenant_id')
            .eq('id', userId)
            .single();
        if (targetError || !target) {
            return NextResponse.json({ error: 'Usuario no encontrado.' }, { status: 404 });
        }
        if (!ctx.isSuperAdmin && target.tenant_id !== ctx.tenantId) {
            return NextResponse.json({ error: 'No autorizado sobre este usuario.' }, { status: 403 });
        }

        // Solo columnas de RRHH presentes en el body.
        const payload: Record<string, any> = {};
        for (const [camel, col] of Object.entries(HR_FIELD_MAP)) {
            if (camel in body) payload[col] = body[camel] || null;
        }

        if (Object.keys(payload).length === 0) {
            return NextResponse.json({ success: true }); // nada que actualizar
        }

        const { error: updErr } = await admin.from('profiles').update(payload).eq('id', userId);
        if (updErr) {
            return NextResponse.json({ error: updErr.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[users/hr-update]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
