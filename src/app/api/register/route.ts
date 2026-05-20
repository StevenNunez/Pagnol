import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/core/lib/admin';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
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
    return NextResponse.json({ error: error.message || 'Error interno del servidor.' }, { status: 500 });
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
  const fromEmail = process.env.EMAIL_FROM || user;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pagnol.teolabs.app';

  if (!host || !user || !pass) {
    console.warn('[Register API] Email de bienvenida omitido: variables EMAIL_* no configuradas.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  const firstName = adminName.split(' ')[0];
  const year = new Date().getFullYear();

  await transporter.sendMail({
    from: `"PAGNOL" <${fromEmail}>`,
    to: adminEmail,
    subject: `¡Bienvenido a Pagnol, ${firstName}! Tu organización está lista`,
    headers: { 'Importance': 'high' },
    html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bienvenido a Pagnol</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;border-radius:20px 20px 0 0;padding:36px 40px 28px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Sistema de Gestión Operativa</p>
              <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:-1px;color:#ffffff;text-transform:uppercase;">PAGNOL</h1>
              <div style="width:40px;height:3px;background:#f97316;margin:14px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:44px 40px 36px;">

              <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Registro exitoso</p>
              <h2 style="margin:0 0 20px;font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.2;">
                ¡Hola, ${firstName}!<br/>
                <span style="color:#f97316;">${tenantName}</span> ya está en Pagnol
              </h2>

              <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.7;">
                Tu organización fue registrada exitosamente. Ahora eres el <strong style="color:#0f172a;">Administrador</strong> de la plataforma y tienes acceso completo para configurar tu equipo y comenzar a operar.
              </p>

              <!-- Próximos pasos -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#f8fafc;border-radius:16px;padding:24px 28px;">
                    <p style="margin:0 0 16px;font-size:10px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Próximos pasos recomendados</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:28px;font-size:16px;">1.</td>
                              <td style="font-size:14px;color:#0f172a;font-weight:700;">Completa el onboarding inicial</td>
                            </tr>
                          </table>
                          <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Configura los roles clave de tu organización</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:28px;font-size:16px;">2.</td>
                              <td style="font-size:14px;color:#0f172a;font-weight:700;">Invita a tu equipo</td>
                            </tr>
                          </table>
                          <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Agrega administradores, supervisores y operadores</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;">
                          <table cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="width:28px;font-size:16px;">3.</td>
                              <td style="font-size:14px;color:#0f172a;font-weight:700;">Registra tus activos y materiales</td>
                            </tr>
                          </table>
                          <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Empieza a trazabilizar todo desde el módulo Pagnol</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center">
                    <a href="${appUrl}/dashboard"
                       style="display:inline-block;background-color:#f97316;color:#ffffff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;box-shadow:0 8px 20px rgba(249,115,22,0.35);">
                      Ir a mi Panel
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Canales de ayuda -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
                <tr>
                  <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:24px 28px;">
                    <p style="margin:0 0 16px;font-size:10px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">¿Necesitas ayuda?</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;">
                          <p style="margin:0;font-size:13px;color:#0f172a;font-weight:700;">📧 Soporte por correo</p>
                          <p style="margin:2px 0 0;font-size:12px;color:#64748b;">hola@teolabs.app — respondemos en menos de 24 hrs hábiles</p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;">
                          <p style="margin:0;font-size:13px;color:#0f172a;font-weight:700;">🌐 Plataforma</p>
                          <p style="margin:2px 0 0;font-size:12px;color:#3b82f6;">${appUrl}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">
                © ${year} TeoLabs — Infraestructura de Gestión
              </p>
              <p style="margin:0;font-size:10px;color:#e2e8f0;">
                hola@teolabs.app
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  });
}
