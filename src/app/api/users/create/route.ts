import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAuth, resolveTenant, hasPermission } from '@/modules/core/lib/api-auth';

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        // Crear/enrolar personal: basta con gestión de usuarios O el permiso de enrolar
        // (para roles como Calidad que solo ayudan a enrolar, sin control total de usuarios).
        if (!hasPermission(ctx, 'users:create') && !hasPermission(ctx, 'pagnol:enroll_personal')) {
            return NextResponse.json({ error: 'No autorizado para crear personal.' }, { status: 403 });
        }

        const { email, password, name, role, tenantId: bodyTenantId, internalId, rut,
                biometric_template, kyc_face_image, kyc_id_front, kyc_id_back,
                enrolledByName } = await request.json();

        if (!email) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        // El tenant lo determina el perfil del llamante (super-admin puede operar cross-tenant).
        // Nunca se confía en el tenantId del body para usuarios normales.
        const tenantId = resolveTenant(ctx, bodyTenantId);
        if (!tenantId) {
            return NextResponse.json({ error: 'Tenant no resuelto' }, { status: 400 });
        }

        // Solo un super-admin puede crear otro super-admin.
        if (role === 'super-admin' && !ctx.isSuperAdmin) {
            return NextResponse.json({ error: 'No autorizado para asignar este rol.' }, { status: 403 });
        }

        const admin = ctx.admin;

        // Create auth user without affecting the current admin session.
        // Sin password explícita se genera una aleatoria e irrecuperable (el
        // usuario entra por QR/biometría o vía "olvidé mi contraseña"); antes
        // el fallback era una constante pública en el código fuente.
        const { data: authData, error: authError } = await admin.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password: password || randomBytes(24).toString('base64url'),
            email_confirm: true,
            user_metadata: { name, role, tenant_id: tenantId },
        });

        if (authError) {
            return NextResponse.json({ error: authError.message }, { status: 400 });
        }

        const newUser = authData.user;
        if (!newUser) {
            return NextResponse.json({ error: 'No se pudo crear el usuario' }, { status: 500 });
        }

        const qrCode = `USER-${newUser.id}`;

        // Upsert profile (sin documentos KYC: van en profile_documents)
        const { error: profileError } = await admin
            .from('profiles')
            .upsert({
                id: newUser.id,
                name,
                email: email.trim().toLowerCase(),
                rut: rut || '',
                role,
                tenant_id: tenantId,
                internal_id: internalId,
                qr_code: qrCode,
                biometric_template: biometric_template || null,
                enrolled_by: enrolledByName || 'System',
                enrolled_at: new Date().toISOString(),
                onboarding_completed: !!biometric_template,
                granted_permissions: [],
            });

        if (profileError) {
            // Rollback: delete the auth user if profile creation fails
            await admin.auth.admin.deleteUser(newUser.id);
            return NextResponse.json({ error: profileError.message }, { status: 500 });
        }

        // Documentos KYC en tabla protegida (RLS dueño/admin). Vía service role.
        if (kyc_face_image || kyc_id_front || kyc_id_back) {
            const { error: docError } = await admin
                .from('profile_documents')
                .upsert({
                    profile_id: newUser.id,
                    tenant_id: tenantId,
                    kyc_face_image: kyc_face_image || null,
                    kyc_id_front: kyc_id_front || null,
                    kyc_id_back: kyc_id_back || null,
                    updated_at: new Date().toISOString(),
                });
            if (docError) {
                // No es fatal para la creación del usuario; se registra para diagnóstico.
                console.error('[users/create] profile_documents upsert error:', docError.message);
            }
        }

        return NextResponse.json({ success: true, userId: newUser.id });
    } catch (err: any) {
        console.error('[users/create]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
