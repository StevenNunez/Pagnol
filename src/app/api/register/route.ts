import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/core/lib/admin';
import { sendWelcomeEmail } from '@/modules/core/lib/welcomeEmail';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

export async function POST(request: Request) {
  try {
    if (!(await rateLimitByIp(request, 'register', 3, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
    }

    const { tenantName, tenantId, adminName, adminEmail, phone, password } = await request.json();

    if (!tenantName || !tenantId || !adminName || !adminEmail || !password) {
      return NextResponse.json({ error: 'Faltan campos requeridos.' }, { status: 400 });
    }

    // 1. Crear usuario en Supabase Auth (admin bypassa RLS y confirma email automáticamente)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password,
      user_metadata: { name: adminName, role: 'administrador' },
      email_confirm: true,
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('email')) {
        return NextResponse.json({ error: 'Este correo electrónico ya está registrado.' }, { status: 409 });
      }
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    const userId = authData.user.id;

    // 2. Crear tenant
    const { data: tenantData, error: tenantError } = await supabaseAdmin
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
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => null);
      return NextResponse.json({ error: tenantError.message }, { status: 400 });
    }

    // 3. Crear perfil del administrador
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: userId,
        name: adminName,
        email: adminEmail,
        role: 'administrador',
        tenant_id: tenantData.id,
        qr_code: userId,
        phone: phone || '',
        created_at: new Date().toISOString(),
        is_active: true,
        onboarding_completed: false,
      });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => null);
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    // Enviar email de bienvenida (no bloquea el registro si falla)
    sendWelcomeEmail({ adminName, adminEmail, tenantName }).catch((err) =>
      console.error('[Register API] Error al enviar email de bienvenida:', err)
    );

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error('[Register API]', error);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
