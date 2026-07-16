import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { materializeLaborForTenant } from '@/lib/labor-cost';

// Cron diario (ver vercel.json, 06:00 UTC ≈ 02:00–03:00 Chile: el día ya cerró
// en America/Santiago). Materializa el costo de mano de obra de TODOS los
// tenants (ADR-003): días cerrados + reconciliación de la ventana móvil.
// Fallback manual por tenant: POST /api/finance/labor-refresh (admin).

export const maxDuration = 300;

export async function GET(req: NextRequest) {
    // Protección fail-closed (patrón uf-rate): sin CRON_SECRET configurado,
    // el endpoint queda deshabilitado en vez de abierto.
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('CRON_SECRET no configurado — cron labor-cost deshabilitado por seguridad.');
        return NextResponse.json({ error: 'Cron no configurado (falta CRON_SECRET).' }, { status: 503 });
    }
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    try {
        const admin = getSupabaseAdmin();
        const { data: tenants, error } = await admin.from('tenants').select('id, labor_cost_factor');
        if (error) throw error;

        const results: any[] = [];
        let failed = 0;
        // Un tenant con datos rotos no debe frenar la materialización del resto.
        for (const t of tenants || []) {
            try {
                const stats = await materializeLaborForTenant(admin, {
                    id: t.id,
                    laborCostFactor: Number(t.labor_cost_factor) || 1.35,
                });
                results.push(stats);
            } catch (e: any) {
                failed++;
                console.error(`labor-cost tenant ${t.id}:`, e);
                results.push({ tenantId: t.id, error: e?.message || 'Error desconocido' });
            }
        }

        const totals = results.reduce(
            (acc, r) => ({
                emitted: acc.emitted + (r.emitted || 0),
                mirrors: acc.mirrors + (r.mirrors || 0),
                noSalaryWorkers: acc.noSalaryWorkers + (r.noSalaryWorkers || 0),
            }),
            { emitted: 0, mirrors: 0, noSalaryWorkers: 0 },
        );
        return NextResponse.json({ ok: failed === 0, tenants: results.length, failed, ...totals, results });
    } catch (e: any) {
        console.error('cron labor-cost:', e);
        return NextResponse.json({ error: e?.message || 'Error desconocido' }, { status: 500 });
    }
}
