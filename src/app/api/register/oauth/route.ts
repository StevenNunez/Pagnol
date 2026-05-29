import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: Request) {
  try {
    // Verify the caller is the authenticated Google user
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.replace('Bearer ', '');

    if (!accessToken) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const admin = getAdminClient();

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
    }).catch(err => console.error('[OAuthRegister] Welcome email failed:', err?.message));

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[OAuthRegister]', err?.message);
    return NextResponse.json({ error: err.message || 'Error interno.' }, { status: 500 });
  }
}

async function sendWelcomeEmail({ adminName, adminEmail, tenantName }: {
  adminName: string;
  adminEmail: string;
  tenantName: string;
}) {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT) || 465;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const fromEmail = process.env.EMAIL_FROM || 'hola@teolabs.app';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pagnol.teolabs.app';

  if (!host || !user || !pass) return;

  const transporter = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000, socketTimeout: 15000,
  });

  const firstName = adminName.split(' ')[0];
  const year = new Date().getFullYear();

  await transporter.sendMail({
    from: `"PAGNOL" <${fromEmail}>`,
    to: adminEmail,
    subject: `¡Bienvenido a Pagnol, ${firstName}! Tu organización está lista`,
    html: `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
<tr><td align="center"><table style="max-width:560px;width:100%;">
  <tr><td style="background:#0f172a;border-radius:20px 20px 0 0;padding:32px 40px 24px;text-align:center;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Sistema de Gestión Operativa</p>
    <h1 style="margin:0;font-size:30px;font-weight:900;color:#fff;text-transform:uppercase;">PAGNOL</h1>
    <div style="width:36px;height:3px;background:#f97316;margin:12px auto 0;border-radius:2px;"></div>
  </td></tr>
  <tr><td style="background:#fff;padding:40px 40px 32px;">
    <h2 style="margin:0 0 16px;font-size:24px;font-weight:900;color:#0f172a;">
      ¡Hola, ${firstName}!<br/><span style="color:#f97316;">${tenantName}</span> ya está en Pagnol
    </h2>
    <p style="font-size:15px;color:#475569;line-height:1.7;">
      Registraste tu empresa con tu cuenta de Google. Ahora eres el <strong>Administrador</strong> y tienes acceso completo a la plataforma.
    </p>
    <p style="font-size:13px;color:#64748b;margin-top:16px;">
      Puedes seguir iniciando sesión con el botón <strong>"Continuar con Google"</strong> en la página de login.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0;">
      <tr><td align="center">
        <a href="${appUrl}/dashboard" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;">
          Ir a mi Panel
        </a>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
    <p style="margin:0;font-size:10px;color:#cbd5e1;text-transform:uppercase;font-weight:800;letter-spacing:2px;">
      © ${year} TeoLabs — hola@teolabs.app
    </p>
  </td></tr>
</table></td></tr>
</table>
</body></html>`,
  });
}
