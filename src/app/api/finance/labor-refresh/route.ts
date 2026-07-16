import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { materializeLaborForTenant } from '@/lib/labor-cost';

// Fallback manual del cron labor-cost (patrón uf-refresh): un admin puede
// forzar la materialización del costo de MO de SU tenant desde el panel de
// Finanzas (p.ej. tras configurar sueldos base que faltaban, sin esperar al
// cron de la madrugada). Solo re-ejecuta la reconciliación — no acepta montos.

export const maxDuration = 300;

async function verifyAdmin(req: NextRequest): Promise<{ tenantId: string | null; isSuperAdmin: boolean } | null> {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const client = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { data: { user }, error } = await client.auth.getUser(token);
    if (error || !user) return null;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin.from('profiles').select('role, tenant_id').eq('id', user.id).single();
    if (!profile || !['super-admin', 'administrador', 'soporte-pagnol'].includes(profile.role || '')) return null;
    return { tenantId: profile.tenant_id ?? null, isSuperAdmin: profile.role === 'super-admin' };
}

export async function POST(req: NextRequest) {
    try {
        const caller = await verifyAdmin(req);
        if (!caller) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        // El tenant del body solo se honra para super-admin (tenant conmutado);
        // un admin normal queda clavado al suyo (mismo contrato que el RPC de reverso).
        const body = await req.json().catch(() => ({}));
        const tenantId = caller.isSuperAdmin && body?.tenantId ? String(body.tenantId) : caller.tenantId;
        if (!tenantId) {
            return NextResponse.json({ error: 'Sin tenant.' }, { status: 400 });
        }

        const admin = getSupabaseAdmin();
        const { data: tenant, error } = await admin
            .from('tenants')
            .select('id, labor_cost_factor')
            .eq('id', tenantId)
            .single();
        if (error || !tenant) {
            return NextResponse.json({ error: 'Tenant no encontrado.' }, { status: 404 });
        }

        const stats = await materializeLaborForTenant(admin, {
            id: tenant.id,
            laborCostFactor: Number(tenant.labor_cost_factor) || 1.35,
        });
        return NextResponse.json({ ok: true, ...stats });
    } catch (e: any) {
        console.error('labor-refresh:', e);
        return NextResponse.json({ error: e?.message || 'Error desconocido' }, { status: 500 });
    }
}
