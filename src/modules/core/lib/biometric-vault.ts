import 'server-only';
import type { getSupabaseAdmin } from '@/modules/core/lib/supabase';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Acceso de servidor a la bóveda de descriptores faciales
 * (`biometric_templates`, migración `20260816000000`).
 *
 * `import 'server-only'` no es decorativo: si alguien importara este módulo
 * desde un componente de cliente, el build FALLA en vez de mandar al navegador
 * código que sabe leer templates. La bóveda no tiene ninguna policy para
 * `authenticated`, así que igual no habría podido leerla, pero el error temprano
 * es mejor que la sorpresa en runtime.
 */

export interface GuardarTemplateArgs {
    userId: string;
    tenantId: string | null;
    template: string;
    enrolledBy?: string | null;
}

/**
 * Escribe (o reemplaza) el descriptor de un trabajador.
 *
 * Un re-enrolamiento SOBRESCRIBE a propósito: el template no es un hecho
 * histórico que se acumule sino el estado actual de "así es su cara hoy", y
 * conservar versiones viejas sería guardar dato biométrico de más sin usarlo
 * para nada. El rastro de QUE hubo enrolamiento sí queda, en
 * `profiles.enrolled_by` / `enrolled_at`.
 */
export async function guardarTemplate(
    admin: Admin,
    { userId, tenantId, template, enrolledBy }: GuardarTemplateArgs,
): Promise<{ ok: true } | { ok: false; error: string }> {
    const ahora = new Date().toISOString();

    const { error } = await admin
        .from('biometric_templates')
        .upsert({
            user_id: userId,
            tenant_id: tenantId,
            template,
            enrolled_by: enrolledBy || 'System',
            enrolled_at: ahora,
            updated_at: ahora,
        }, { onConflict: 'user_id' });

    if (error) {
        console.error('[biometric-vault] guardarTemplate:', error.message);
        return { ok: false, error: error.message };
    }

    // `profiles.biometric_enrolled` lo mantiene un trigger de la bóveda: no se
    // escribe acá para que no existan dos fuentes de verdad del mismo booleano.
    return { ok: true };
}

export interface SesionEnrolamiento {
    template: string | null;
    kycFaceImage: string | null;
    kycIdFront: string | null;
    kycIdBack: string | null;
}

/**
 * Lee y VACÍA una sesión de enrolamiento por QR.
 *
 * Por qué existe: el asistente de enrolamiento hacía polling de
 * `enrollment_sessions` desde el navegador y se traía el descriptor facial y las
 * FOTOS DE LA CÉDULA para reenviarlas en el submit. Esa tabla estaba abierta a
 * todo el tenant igual que `profiles` — la segunda puerta al mismo dato, que el
 * backlog no tenía anotada. Ahora el navegador sólo ve el `status` y estos datos
 * viajan del móvil al servidor y del servidor al destino final, sin pasar por el
 * equipo del administrador.
 *
 * Y se vacían al consumirse: una vez copiados a la bóveda y a
 * `profile_documents`, dejar la cédula del trabajador en una tabla intermedia es
 * conservar el dato sensible más tiempo del que se necesita.
 */
export async function consumirSesionEnrolamiento(
    admin: Admin,
    token: string,
    tenantId: string | null,
): Promise<SesionEnrolamiento | null> {
    let q = admin
        .from('enrollment_sessions')
        .select('id, tenant_id, status, biometric_template, kyc_face_image, kyc_id_front, kyc_id_back')
        .eq('token', token)
        .eq('status', 'completed');
    if (tenantId) q = q.eq('tenant_id', tenantId);

    const { data, error } = await q.maybeSingle();
    if (error || !data) return null;

    const resultado: SesionEnrolamiento = {
        template: data.biometric_template ?? null,
        kycFaceImage: data.kyc_face_image ?? null,
        kycIdFront: data.kyc_id_front ?? null,
        kycIdBack: data.kyc_id_back ?? null,
    };

    const { error: limpiezaError } = await admin
        .from('enrollment_sessions')
        .update({
            status: 'consumed',
            biometric_template: null,
            kyc_face_image: null,
            kyc_id_front: null,
            kyc_id_back: null,
        })
        .eq('id', data.id);

    // Que la limpieza falle no invalida el enrolamiento —el dato ya está en
    // manos del servidor— pero sí deja la copia intermedia viva, así que se
    // registra para poder verlo.
    if (limpiezaError) {
        console.error('[biometric-vault] limpiar sesión:', limpiezaError.message);
    }

    return resultado;
}
