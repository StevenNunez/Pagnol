import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
        return NextResponse.json({ valid: false, error: 'Token requerido' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    // Proyección explícita: NO exponer biometric_template ni columnas kyc_*,
    // aunque la sesión las tuviera (defensa en profundidad).
    const { data, error } = await admin
        .from('enrollment_sessions')
        .select('id, token, name, email, rut, role, internal_id, tenant_id, admin_id, status, expires_at, created_at')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

    if (error || !data) {
        return NextResponse.json({ valid: false, error: 'Sesión inválida o expirada' });
    }

    // El nombre de la empresa va en el texto del consentimiento: la responsable
    // del tratamiento es ella, no Pagnol, que es sólo el proveedor. Un texto que
    // dijera "autorizo a Pagnol" no serviría de nada ante un reclamo laboral.
    let companyName = '';
    if (data.tenant_id) {
        const { data: tenant } = await admin
            .from('tenants')
            .select('name')
            .eq('id', data.tenant_id)
            .maybeSingle();
        companyName = tenant?.name || '';
    }

    // Si ya aceptó (por ejemplo recargó la página a mitad de camino), no se le
    // vuelve a pedir la firma.
    const { count } = await admin
        .from('biometric_consents')
        .select('id', { count: 'exact', head: true })
        .eq('enrollment_token', token);

    return NextResponse.json({
        valid: true,
        session: data,
        companyName,
        consentGiven: (count ?? 0) > 0,
    });
}
