import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireAuth, resolveTenant, hasPermission } from '@/modules/core/lib/api-auth';
import { guardarTemplate, consumirSesionEnrolamiento } from '@/modules/core/lib/biometric-vault';

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
                biometric_template: templateDelCuerpo,
                kyc_face_image: kycCaraDelCuerpo,
                kyc_id_front: kycFrenteDelCuerpo,
                kyc_id_back: kycDorsoDelCuerpo,
                enrollmentToken,
                enrolledByName, contractId, shiftScheduleId, rotationStartDate } = await request.json();

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

        // Enrolamiento por QR: el descriptor y los documentos vienen de la sesión
        // que el trabajador completó en su móvil, leídos server-side. El navegador
        // del administrador nunca los tuvo. (Ver `biometric-vault.ts`.)
        const sesion = enrollmentToken
            ? await consumirSesionEnrolamiento(admin, enrollmentToken, ctx.isSuperAdmin ? null : tenantId)
            : null;

        const biometric_template = sesion?.template ?? templateDelCuerpo ?? null;
        const kyc_face_image = sesion?.kycFaceImage ?? kycCaraDelCuerpo ?? null;
        const kyc_id_front = sesion?.kycIdFront ?? kycFrenteDelCuerpo ?? null;
        const kyc_id_back = sesion?.kycIdBack ?? kycDorsoDelCuerpo ?? null;

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
                // El descriptor NO se guarda acá: va a la bóveda más abajo.
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

        // Biometría en la bóveda (nunca en `profiles`, donde la lee todo el tenant).
        // Si falla, el usuario ya existe y es utilizable: se avisa en vez de
        // deshacer la creación entera, porque re-enrolar es un botón y volver a
        // crear al trabajador no.
        if (biometric_template) {
            const guardado = await guardarTemplate(admin, {
                userId: newUser.id,
                tenantId,
                template: biometric_template,
                enrolledBy: enrolledByName,
            });
            if (!guardado.ok) {
                console.error('[users/create] biometría no guardada:', guardado.error);
            }
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

        // Asignación a contrato al crear (Fase 2 Valar). Se valida que contrato y turno
        // pertenezcan al tenant porque el service role salta RLS. No es fatal: el usuario
        // ya existe; si falla se devuelve `warning` para que la UI lo muestre.
        let warning: string | null = null;
        if (contractId) {
            const { data: contractRow } = await admin
                .from('contracts')
                .select('id')
                .eq('id', contractId)
                .eq('tenant_id', tenantId)
                .maybeSingle();

            if (!contractRow) {
                warning = 'El contrato seleccionado no existe en esta empresa; el trabajador quedó sin contrato asignado.';
            } else {
                let shiftId: string | null = null;
                if (shiftScheduleId) {
                    const { data: shiftRow } = await admin
                        .from('shift_schedules')
                        .select('id')
                        .eq('id', shiftScheduleId)
                        .eq('tenant_id', tenantId)
                        .maybeSingle();
                    shiftId = shiftRow?.id ?? null;
                }
                const cwPayload: Record<string, any> = {
                    tenant_id: tenantId,
                    contract_id: contractId,
                    user_id: newUser.id,
                    shift_schedule_id: shiftId,
                };
                // Ancla del ciclo del trabajador (solo con turno); se omite si no viene
                // para no romper el insert antes de aplicar la migración de la columna.
                if (shiftId && typeof rotationStartDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rotationStartDate)) {
                    cwPayload.rotation_start_date = rotationStartDate;
                }
                const { error: cwError } = await admin
                    .from('contract_workers')
                    .insert(cwPayload);
                if (cwError) {
                    console.error('[users/create] contract_workers insert error:', cwError.message);
                    warning = `El usuario se creó pero no se pudo asignar al contrato: ${cwError.message}`;
                }
            }
        }

        return NextResponse.json({ success: true, userId: newUser.id, ...(warning ? { warning } : {}) });
    } catch (err: any) {
        console.error('[users/create]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
