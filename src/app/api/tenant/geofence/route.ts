import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';

async function getAuthedAdmin(req: Request) {
    const accessToken = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!accessToken) return null;
    const admin = getSupabaseAdmin();
    const { data: { user } } = await admin.auth.getUser(accessToken);
    if (!user) return null;
    const { data: profile } = await admin
        .from('profiles')
        .select('tenant_id, role')
        .eq('id', user.id)
        .single();
    if (!profile) return null;
    const allowed = ['administrador', 'super-admin', 'director-faena'];
    if (!allowed.includes(profile.role)) return null;
    return { admin, tenantId: profile.tenant_id };
}

export async function GET(req: Request) {
    const ctx = await getAuthedAdmin(req);
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const { data } = await ctx.admin
        .from('tenants')
        .select('geo_lat, geo_lng, geo_radius_m')
        .eq('id', ctx.tenantId)
        .single();

    return NextResponse.json(data ?? {});
}

export async function POST(req: Request) {
    const ctx = await getAuthedAdmin(req);
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    const { lat, lng, radius_m } = await req.json();

    if (lat == null || lng == null || !radius_m) {
        return NextResponse.json({ error: 'Datos incompletos' }, { status: 400 });
    }

    const { error } = await ctx.admin
        .from('tenants')
        .update({ geo_lat: lat, geo_lng: lng, geo_radius_m: radius_m })
        .eq('id', ctx.tenantId);

    if (error) {
        console.error('[tenant/geofence] update:', error.message);
        return NextResponse.json({ error: 'Error al guardar la configuración.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
    const ctx = await getAuthedAdmin(req);
    if (!ctx) return NextResponse.json({ error: 'No autorizado' }, { status: 403 });

    await ctx.admin
        .from('tenants')
        .update({ geo_lat: null, geo_lng: null, geo_radius_m: 300 })
        .eq('id', ctx.tenantId);

    return NextResponse.json({ ok: true });
}
