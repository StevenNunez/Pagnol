import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { runDispatch } from '@/lib/api/webhooks/dispatch';

// Despachador de webhooks de la API pública (ver src/lib/api/webhooks/dispatch.ts).
// Hay que llamarlo seguido (cada minuto): de su cadencia depende qué tan rápido
// llega un evento y cuándo se reintenta uno fallido. Vercel Cron en el plan
// Hobby sólo admite pulsos diarios, así que el pulso fino viene de afuera
// (pg_cron de Supabase, scripts/webhooks-pulso.sql); el cron diario de
// vercel.json es la red de seguridad.
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('CRON_SECRET no configurado — cron deshabilitado por seguridad.');
        return NextResponse.json({ error: 'Cron no configurado (falta CRON_SECRET).' }, { status: 503 });
    }
    if (req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        return NextResponse.json({ ok: true, ...(await runDispatch(getSupabaseAdmin())) });
    } catch (err: any) {
        console.error('[cron webhooks]', err?.message || err);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
