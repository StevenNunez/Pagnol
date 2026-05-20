import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

export async function POST(request: Request) {
    try {
        const { email, password, name, role, tenantId, internalId, rut,
                biometric_template, kyc_face_image, kyc_id_front, kyc_id_back,
                enrolledByName } = await request.json();

        if (!email || !tenantId) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();

        // Create auth user without affecting the current admin session
        const { data: authData, error: authError } = await admin.auth.admin.createUser({
            email: email.trim().toLowerCase(),
            password: password || 'TemporaryPassword123!',
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

        // Upsert profile with all fields
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
                kyc_face_image: kyc_face_image || null,
                kyc_id_front: kyc_id_front || null,
                kyc_id_back: kyc_id_back || null,
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

        return NextResponse.json({ success: true, userId: newUser.id });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
