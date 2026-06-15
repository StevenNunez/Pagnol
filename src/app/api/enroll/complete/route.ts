import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

export async function POST(request: Request) {
    try {
        const { token, biometric_template, kyc_face_image, kyc_id_front, kyc_id_back } = await request.json();

        if (!token || !biometric_template) {
            return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();
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
            .select('id');

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

        return NextResponse.json({ success: true });
    } catch (err: any) {
        console.error('[enroll/complete]', err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
