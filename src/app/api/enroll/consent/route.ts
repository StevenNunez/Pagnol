import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { buildConsentText, CONSENT_VERSION } from '@/modules/core/lib/biometric-consent';

/**
 * Registra el consentimiento que el trabajador acepta en su propio teléfono,
 * antes de la primera foto.
 *
 * Es una ruta pública, como el resto de `/api/enroll/*`: quien la llama todavía
 * no tiene cuenta —muchas veces el enrolamiento ES su alta— y lo único que
 * autoriza la operación es el token de la sesión, que caduca en 30 minutos.
 *
 * El texto NO viene del cuerpo: se reconstruye acá con el nombre de la empresa
 * dueña de la sesión. Si viniera del navegador, cualquiera podría guardar una
 * constancia de haber aceptado un texto que nunca se mostró.
 */
export async function POST(request: Request) {
    try {
        const { token } = await request.json();
        if (!token || typeof token !== 'string') {
            return NextResponse.json({ error: 'Token requerido' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();
        const { data: sesion } = await admin
            .from('enrollment_sessions')
            .select('id, token, tenant_id, user_id, name, email, rut')
            .eq('token', token)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();

        if (!sesion) {
            return NextResponse.json({ error: 'Sesión inválida o expirada.' }, { status: 410 });
        }

        let companyName = '';
        if (sesion.tenant_id) {
            const { data: tenant } = await admin
                .from('tenants').select('name').eq('id', sesion.tenant_id).maybeSingle();
            companyName = tenant?.name || '';
        }

        const cabeceras = request.headers;
        const { error } = await admin.from('biometric_consents').insert({
            tenant_id: sesion.tenant_id,
            user_id: sesion.user_id,
            enrollment_token: token,
            subject_name: sesion.name,
            subject_rut: sesion.rut,
            subject_email: sesion.email,
            consent_version: CONSENT_VERSION,
            consent_text: buildConsentText(companyName),
            channel: 'mobile_qr',
            ip: cabeceras.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
            user_agent: cabeceras.get('user-agent') || null,
        });

        if (error) {
            console.error('[enroll/consent]', error.message);
            return NextResponse.json({ error: 'No se pudo registrar la autorización.' }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[enroll/consent]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
