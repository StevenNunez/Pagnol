import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    if (!token) {
        return NextResponse.json({ valid: false, error: 'Token requerido' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data, error } = await admin
        .from('enrollment_sessions')
        .select('*')
        .eq('token', token)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

    if (error || !data) {
        return NextResponse.json({ valid: false, error: 'Sesión inválida o expirada' });
    }

    return NextResponse.json({ valid: true, session: data });
}
