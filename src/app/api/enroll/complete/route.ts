import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

export async function POST(request: Request) {
    try {
        const { token, biometric_template, kyc_face_image, kyc_id_front, kyc_id_back } = await request.json();

        if (!token || !biometric_template) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();
        const { error } = await admin
            .from('enrollment_sessions')
            .update({
                status: 'completed',
                biometric_template,
                kyc_face_image,
                kyc_id_front,
                kyc_id_back,
                completed_at: new Date().toISOString(),
            })
            .eq('token', token);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
