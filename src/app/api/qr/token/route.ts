import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { randomBytes } from 'crypto';
import { haversineMeters } from '@/lib/geo';

const TOKEN_LIFETIME_SECONDS = 120;

export async function POST(req: Request) {
    const accessToken = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!accessToken) {
        return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    const { data: { user }, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !user) {
        return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
    }

    const { data: profile } = await admin
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

    if (!profile) {
        return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 404 });
    }

    // El QR de asistencia siempre pertenece a una empresa/faena. Si el perfil no
    // tiene tenant asignado (p. ej. un super-admin sin faena, o un perfil mal
    // configurado), no se puede generar un token válido → error claro en vez de
    // dejar reventar el constraint NOT NULL de qr_tokens.
    if (!profile.tenant_id) {
        return NextResponse.json(
            {
                error: 'NO_TENANT',
                message: 'Tu perfil no tiene una empresa o faena asignada. Contacta a tu administrador para activar tu credencial.',
            },
            { status: 400 }
        );
    }

    // Validar geolocalización si el tenant tiene geofence configurado
    const { data: tenant } = await admin
        .from('tenants')
        .select('geo_lat, geo_lng, geo_radius_m')
        .eq('id', profile.tenant_id)
        .single();

    if (tenant?.geo_lat != null && tenant?.geo_lng != null) {
        const body = await req.json().catch(() => ({}));
        const { latitude, longitude } = body as { latitude?: number; longitude?: number };

        if (latitude == null || longitude == null) {
            return NextResponse.json(
                { error: 'GPS_REQUIRED', message: 'Se requiere ubicación GPS para generar el QR en esta faena.' },
                { status: 403 }
            );
        }

        const distance = haversineMeters(tenant.geo_lat, tenant.geo_lng, latitude, longitude);
        const radius = tenant.geo_radius_m ?? 300;

        if (distance > radius) {
            return NextResponse.json(
                { error: 'OUTSIDE_GEOFENCE', distance_m: Math.round(distance), radius_m: radius },
                { status: 403 }
            );
        }
    }

    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_SECONDS * 1000);

    // Reemplazar tokens anteriores del usuario (solo uno válido a la vez)
    await admin.from('qr_tokens').delete().eq('user_id', user.id);

    const { error: insertError } = await admin.from('qr_tokens').insert({
        user_id:    user.id,
        tenant_id:  profile.tenant_id,
        token,
        expires_at: expiresAt.toISOString(),
    });

    if (insertError) {
        console.error('[qr/token] insert error:', insertError.message);
        return NextResponse.json(
            { error: 'Error al generar el token QR.' },
            { status: 500 }
        );
    }

    return NextResponse.json({
        qr_value:   `PAGNOL:${user.id}:${token}`,
        expires_in: TOKEN_LIFETIME_SECONDS,
        expires_at: expiresAt.toISOString(),
        geo_status: tenant?.geo_lat != null ? 'verified' : 'not_configured',
    });
}
