import 'server-only';
import type { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { buildConsentText, CONSENT_VERSION } from '@/modules/core/lib/biometric-consent';

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * Constancias de consentimiento biométrico, del lado servidor.
 *
 * El texto NUNCA viaja en el cuerpo del request: se reconstruye acá con el
 * nombre de la empresa. Si el navegador pudiera mandarlo, la constancia
 * guardada dejaría de ser prueba de nada — cualquiera podría archivar un texto
 * que jamás se mostró en pantalla.
 */

async function nombreEmpresa(admin: Admin, tenantId: string | null): Promise<string> {
    if (!tenantId) return '';
    const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
    return data?.name || '';
}

export interface ConsentimientoEscritorio {
    userId: string;
    tenantId: string | null;
    nombre?: string | null;
    rut?: string | null;
    email?: string | null;
    ip?: string | null;
    userAgent?: string | null;
}

/** Consentimiento firmado en el computador del administrador, con el trabajador presente. */
export async function registrarConsentimientoEscritorio(
    admin: Admin,
    { userId, tenantId, nombre, rut, email, ip, userAgent }: ConsentimientoEscritorio,
): Promise<void> {
    const empresa = await nombreEmpresa(admin, tenantId);
    const { error } = await admin.from('biometric_consents').insert({
        tenant_id: tenantId,
        user_id: userId,
        subject_name: nombre || null,
        subject_rut: rut || null,
        subject_email: email || null,
        consent_version: CONSENT_VERSION,
        consent_text: buildConsentText(empresa),
        channel: 'desktop',
        ip: ip || null,
        user_agent: userAgent || null,
    });
    if (error) console.error('[biometric-consent] escritorio:', error.message);
}

/**
 * Vincula al perfil recién creado la constancia que el trabajador firmó en su
 * teléfono. En ese momento su fila de `profiles` todavía no existía, así que la
 * constancia quedó apuntando sólo al token de la sesión.
 */
export async function vincularConsentimientoDeSesion(
    admin: Admin,
    token: string,
    userId: string,
): Promise<void> {
    const { error } = await admin
        .from('biometric_consents')
        .update({ user_id: userId })
        .eq('enrollment_token', token)
        .is('user_id', null);
    if (error) console.error('[biometric-consent] vincular sesión:', error.message);
}

/** ¿Existe constancia para este token de enrolamiento? */
export async function hayConsentimientoDeSesion(admin: Admin, token: string): Promise<boolean> {
    const { count } = await admin
        .from('biometric_consents')
        .select('id', { count: 'exact', head: true })
        .eq('enrollment_token', token);
    return (count ?? 0) > 0;
}

/** Cabeceras de origen, para dejar rastro de dónde se aceptó. */
export function origenDeLaPeticion(request: Request) {
    return {
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: request.headers.get('user-agent') || null,
    };
}
