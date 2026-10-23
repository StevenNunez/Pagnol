import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/modules/core/lib/api-auth';

/**
 * Borrar los datos biométricos de una persona (plantilla facial, selfie y fotos
 * de la cédula). Dos motivos:
 *
 *   'revocation' → retiró su autorización (la pide ella o RR.HH. por ella)
 *   'separation' → salió de la empresa y quedó pendiente (tenía equipos por
 *                  devolver, así que el borrado automático no corrió)
 *
 * Como en `hr/worker-separation`, la escritura la hace la función
 * `erase_biometric_data` llamada con el TOKEN DE QUIEN ACTÚA: la base ve su
 * `auth.uid()` y decide por sí misma si puede (la propia persona, o RR.HH. de
 * su empresa). Esta ruta no usa service role para escribir.
 */
export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;

        const { workerId, reason } = await request.json();
        if (!workerId || (reason !== 'revocation' && reason !== 'separation')) {
            return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 });
        }

        const token = request.headers.get('authorization')!.replace('Bearer ', '').trim();
        const asUser = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
        );

        const { data, error } = await asUser.rpc('erase_biometric_data', { p_worker: workerId, p_reason: reason });
        if (error) return NextResponse.json({ error: error.message }, { status: 400 });

        return NextResponse.json({ success: true, erased: data });
    } catch (err: any) {
        console.error('[biometric/erase]', err?.message || err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
