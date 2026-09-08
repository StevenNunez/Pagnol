import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { guardarTemplate } from '@/modules/core/lib/biometric-vault';

/**
 * Cierre del enrolamiento hecho por el trabajador desde su teléfono.
 *
 * ANTES: esta ruta sólo dejaba el descriptor y las fotos aparcados en
 * `enrollment_sessions`, y el enrolamiento se volvía real recién cuando el
 * administrador apretaba "Guardar y Finalizar" en el computador. Si cerraba el
 * diálogo, cambiaba de página o se le dormía el equipo, el dato quedaba
 * huérfano — y el teléfono ya le había dicho al trabajador, en verde,
 * "Verificación completa". Pasó de verdad: 3 sesiones quedaron así.
 *
 * AHORA: cuando la sesión ya apunta a un usuario existente (`user_id`), el
 * servidor materializa el enrolamiento en este mismo request. No hay nada que
 * esperar de nadie: el destino se conoce desde que se generó el QR.
 *
 * El único caso que sigue necesitando al administrador es el ALTA de un
 * trabajador nuevo (`user_id` nulo): ahí el perfil todavía no existe y faltan
 * los datos del formulario. Esa sesión queda en `completed` y la consume
 * `/api/users/create`.
 */
export async function POST(request: Request) {
    try {
        const { token, biometric_template, kyc_face_image, kyc_id_front, kyc_id_back } = await request.json();

        if (!token || !biometric_template) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();

        // Sin autorización firmada no se guarda biometría. Es la base de licitud
        // del tratamiento (Ley 19.628 / Ley 21.719), no un trámite de la UI: por
        // eso se comprueba en el servidor y no basta con que la pantalla lo haya
        // pedido.
        const { count: consentimientos } = await admin
            .from('biometric_consents')
            .select('id', { count: 'exact', head: true })
            .eq('enrollment_token', token);

        if (!consentimientos) {
            return NextResponse.json(
                { error: 'Falta la autorización de tratamiento de datos biométricos.' },
                { status: 403 }
            );
        }

        // Solo completa sesiones PENDIENTES y NO expiradas; evita que un token
        // reutilizado o vencido sobrescriba datos biométricos/KYC.
        const { data, error } = await admin
            .from('enrollment_sessions')
            .update({
                status: 'completed',
                biometric_template,
                kyc_face_image,
                kyc_id_front,
                kyc_id_back,
                completed_at: new Date().toISOString(),
            })
            .eq('token', token)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .select('id, user_id, tenant_id, name, internal_id');

        if (error) {
            console.error('[enroll/complete] update:', error.message);
            return NextResponse.json({ error: 'Error al completar el enrolamiento.' }, { status: 500 });
        }

        if (!data || data.length === 0) {
            return NextResponse.json(
                { error: 'Sesión de enrolamiento inválida, expirada o ya utilizada.' },
                { status: 410 }
            );
        }

        const sesion = data[0];

        // Alta de un trabajador nuevo: no hay perfil al que enrolar todavía.
        if (!sesion.user_id) {
            return NextResponse.json({ success: true, enrolled: false });
        }

        // El perfil tiene que existir y ser del mismo tenant que la sesión: la
        // sesión pudo crearse hace media hora y el perfil pudo borrarse en el
        // intertanto.
        const { data: perfil } = await admin
            .from('profiles')
            .select('id, tenant_id')
            .eq('id', sesion.user_id)
            .maybeSingle();

        if (!perfil || (sesion.tenant_id && perfil.tenant_id !== sesion.tenant_id)) {
            console.error('[enroll/complete] perfil ausente o de otro tenant:', sesion.user_id);
            return NextResponse.json({ success: true, enrolled: false });
        }

        const guardado = await guardarTemplate(admin, {
            userId: perfil.id,
            tenantId: perfil.tenant_id,
            template: biometric_template,
            enrolledBy: sesion.name || 'Autoenrolamiento',
        });

        if (!guardado.ok) {
            // La sesión queda en `completed` con el dato intacto: el administrador
            // todavía puede rescatarla desde el asistente. Se falla hacia el
            // camino viejo, no hacia perder el enrolamiento.
            return NextResponse.json({ success: true, enrolled: false });
        }

        await admin
            .from('profiles')
            .update({
                enrolled_by: sesion.name || 'Autoenrolamiento',
                enrolled_at: new Date().toISOString(),
                onboarding_completed: true,
            })
            .eq('id', perfil.id);

        if (kyc_face_image || kyc_id_front || kyc_id_back) {
            const { error: docError } = await admin
                .from('profile_documents')
                .upsert({
                    profile_id: perfil.id,
                    tenant_id: perfil.tenant_id,
                    kyc_face_image: kyc_face_image || null,
                    kyc_id_front: kyc_id_front || null,
                    kyc_id_back: kyc_id_back || null,
                    updated_at: new Date().toISOString(),
                });
            if (docError) console.error('[enroll/complete] profile_documents:', docError.message);
        }

        // El descriptor y las fotos de la cédula ya están en su destino final:
        // dejar la copia en la tabla intermedia es conservar dato sensible de más.
        const { error: limpiezaError } = await admin
            .from('enrollment_sessions')
            .update({
                status: 'consumed',
                biometric_template: null,
                kyc_face_image: null,
                kyc_id_front: null,
                kyc_id_back: null,
            })
            .eq('id', sesion.id);

        if (limpiezaError) console.error('[enroll/complete] limpiar sesión:', limpiezaError.message);

        return NextResponse.json({ success: true, enrolled: true });
    } catch (err: any) {
        console.error('[enroll/complete]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
