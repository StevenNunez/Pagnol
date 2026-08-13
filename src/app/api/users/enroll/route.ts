import { NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/modules/core/lib/api-auth';
import { guardarTemplate, consumirSesionEnrolamiento } from '@/modules/core/lib/biometric-vault';

/**
 * Enrola biometría + KYC a un usuario YA EXISTENTE.
 *
 * Va por service role (salta RLS) para que también puedan enrolar roles que no son
 * admin del tenant (p.ej. Calidad con `pagnol:enroll_personal`), y para escribir los
 * documentos KYC en la tabla protegida `profile_documents` (que el cliente no toca).
 *
 * Autoriza con el MISMO criterio que crear personal: `users:create` O
 * `pagnol:enroll_personal`.
 */
export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        if (!hasPermission(ctx, 'users:create') && !hasPermission(ctx, 'pagnol:enroll_personal')) {
            return NextResponse.json({ error: 'No autorizado para enrolar personal.' }, { status: 403 });
        }

        const {
            userId, internalId, enrolledByName, enrollmentToken,
            biometric_template: templateDelCuerpo,
            kyc_face_image: kycCaraDelCuerpo,
            kyc_id_front: kycFrenteDelCuerpo,
            kyc_id_back: kycDorsoDelCuerpo,
        } = await request.json();

        if (!userId) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = ctx.admin;

        // Enrolamiento por QR: el descriptor y los documentos NO vienen del
        // navegador del administrador —él nunca los vio— sino de la sesión que
        // completó el trabajador desde su móvil. Se leen y se vacían acá.
        const sesion = enrollmentToken
            ? await consumirSesionEnrolamiento(admin, enrollmentToken, ctx.isSuperAdmin ? null : ctx.tenantId)
            : null;

        // El camino de escritorio (el administrador captura con la cámara del
        // equipo) sí manda el descriptor en el cuerpo: es la cara de quien está
        // ahí en ese momento, no un dato ajeno bajado de la base.
        const biometric_template = sesion?.template ?? templateDelCuerpo ?? null;
        const kyc_face_image = sesion?.kycFaceImage ?? kycCaraDelCuerpo ?? null;
        const kyc_id_front = sesion?.kycIdFront ?? kycFrenteDelCuerpo ?? null;
        const kyc_id_back = sesion?.kycIdBack ?? kycDorsoDelCuerpo ?? null;

        // El usuario a enrolar debe pertenecer al tenant del llamante (salvo super-admin).
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

        const profilePayload: Record<string, any> = {};
        if (internalId !== undefined) profilePayload.internal_id = internalId;
        if (biometric_template) {
            // El descriptor va a la bóveda, NO a `profiles`: en profiles lo lee
            // por REST cualquier miembro del tenant. `profiles.biometric_enrolled`
            // lo enciende el trigger de la bóveda, no este código.
            const guardado = await guardarTemplate(admin, {
                userId,
                tenantId: target.tenant_id,
                template: biometric_template,
                enrolledBy: enrolledByName,
            });
            if (!guardado.ok) {
                return NextResponse.json({ error: 'No se pudo guardar la biometría.' }, { status: 500 });
            }
            profilePayload.enrolled_by = enrolledByName || 'System';
            profilePayload.enrolled_at = new Date().toISOString();
            profilePayload.onboarding_completed = true;
        }

        if (Object.keys(profilePayload).length > 0) {
            const { error: updErr } = await admin.from('profiles').update(profilePayload).eq('id', userId);
            if (updErr) {
                return NextResponse.json({ error: updErr.message }, { status: 500 });
            }
        }

        // Documentos KYC en tabla protegida (RLS dueño/admin). Vía service role.
        if (kyc_face_image || kyc_id_front || kyc_id_back) {
            const { error: docError } = await admin
                .from('profile_documents')
                .upsert({
                    profile_id: userId,
                    tenant_id: target.tenant_id,
                    kyc_face_image: kyc_face_image || null,
                    kyc_id_front: kyc_id_front || null,
                    kyc_id_back: kyc_id_back || null,
                    updated_at: new Date().toISOString(),
                });
            if (docError) {
                console.error('[users/enroll] profile_documents upsert error:', docError.message);
            }
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[users/enroll]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
