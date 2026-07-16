import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { refreshUfRates } from '@/lib/uf-rates';

// Fallback manual del cron uf-rate: un admin puede forzar la re-consulta de la
// UF desde Configuración (p.ej. si el cron falló). Nota deliberada: NO acepta
// un valor digitado — la tabla uf_rates es global a todos los tenants y solo se
// alimenta de la fuente oficial.

async function verifyAdmin(req: NextRequest): Promise<boolean> {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return false;
    const token = authHeader.slice(7);
    const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return false;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    return ['super-admin', 'administrador', 'soporte-pagnol'].includes(profile?.role || '');
}

export async function POST(req: NextRequest) {
    try {
        if (!(await verifyAdmin(req))) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }
        const result = await refreshUfRates();
        return NextResponse.json({ ok: true, ...result });
    } catch (e: any) {
        console.error('uf-refresh:', e);
        return NextResponse.json({ error: e?.message || 'Error desconocido' }, { status: 500 });
    }
}
