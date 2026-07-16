import { NextRequest, NextResponse } from 'next/server';
import { refreshUfRates } from '@/lib/uf-rates';

// Cron diario (ver vercel.json): sincroniza `uf_rates` desde mindicador.cl.
// El ledger financiero congela fx_rate en cada hecho, así que un valor atrasado
// nunca reescribe historia: solo afecta hechos futuros hasta que el cron se
// recupere. Fallback manual: POST /api/finance/uf-refresh (admin).

export async function GET(req: NextRequest) {
    // Protección fail-closed (patrón rental-alerts): sin CRON_SECRET configurado,
    // el endpoint queda deshabilitado en vez de abierto.
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('CRON_SECRET no configurado — cron uf-rate deshabilitado por seguridad.');
        return NextResponse.json({ error: 'Cron no configurado (falta CRON_SECRET).' }, { status: 503 });
    }
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const result = await refreshUfRates();
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        console.error('cron uf-rate:', e);
        return NextResponse.json({ error: e?.message || 'Error desconocido' }, { status: 500 });
    }
}
