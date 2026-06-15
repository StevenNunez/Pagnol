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

    return NextResponse.json({ valid: true, session: data });
}
