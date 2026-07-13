import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { sendWelcomeEmail } from '@/modules/core/lib/welcomeEmail';

export async function POST(request: Request) {
  try {
    // Verify the caller is the authenticated Google user
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');

    if (!accessToken) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const admin = getSupabaseAdmin();

    // Verify the access token and get the user
    const { data: { user }, error: userError } = await admin.auth.getUser(accessToken);

    if (userError || !user) {
      return NextResponse.json({ error: 'Sesión inválida. Intenta iniciar sesión nuevamente.' }, { status: 401 });
    }

    // Only allow OAuth users (Google, etc.) through this route
    const providers = (user.app_metadata?.providers as string[] | undefined) ?? [];
    const isOAuthOnly = providers.length > 0 && !providers.includes('email');
    // Allow if they registered via OAuth OR if they have no profile yet
    // (the check below will handle the latter)

    const { tenantName, tenantId, adminName, phone } = await request.json();

    if (!tenantName || !tenantId || !adminName) {
      return NextResponse.json({ error: 'Faltan campos requeridos.' }, { status: 400 });
    }

    // Guard: make sure this user doesn't already have a profile/tenant
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', user.id)
      .maybeSingle();

    if (existingProfile?.tenant_id) {
      return NextResponse.json({ error: 'Esta cuenta ya está registrada en una empresa.' }, { status: 409 });
    }

    // 1. Create tenant
    const { data: tenantData, error: tenantError } = await admin
      .from('tenants')
      .insert({
        name: tenantName,
        tenant_id: tenantId,
        plan: 'enterprise',
        is_active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (tenantError) {
      return NextResponse.json({ error: tenantError.message }, { status: 400 });
    }

    // 2. Create (or update) profile linked to the Google user ID
    const { error: profileError } = await admin
      .from('profiles')
      .upsert({
        id: user.id,
        name: adminName,
        email: user.email,
        role: 'administrador',
        tenant_id: tenantData.id,
        qr_code: user.id,
        phone: phone || '',
        created_at: new Date().toISOString(),
        is_active: true,
        onboarding_completed: false,
      });

    if (profileError) {
      // Roll back tenant creation
      try { await admin.from('tenants').delete().eq('id', tenantData.id); } catch { /* rollback best-effort */ }
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    // 3. Send welcome email (non-blocking)
    sendWelcomeEmail({
      adminName,
      adminEmail: user.email!,
      tenantName,
      viaGoogle: true,
    }).catch(err => console.error('[OAuthRegister] Welcome email failed:', err?.message));

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[OAuthRegister]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
