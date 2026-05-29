import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/modules/core/lib/admin';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Correo requerido.' }, { status: 400 });
    }

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/update-password`;

    // Generate the recovery link via Admin API (bypasses Supabase email sending)
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email.toLowerCase().trim(),
      options: { redirectTo },
    });

    // Always respond generically to prevent user enumeration
    if (error || !data?.properties?.action_link) {
      // Log the real error server-side but don't expose it
      console.error('[ResetPassword API] generateLink error:', error?.message ?? 'No link returned');
      return NextResponse.json({ success: true });
    }

    const actionLink = data.properties.action_link;
    const firstName = data.user?.user_metadata?.name?.split(' ')[0] ?? 'Usuario';
    const year = new Date().getFullYear();

    await sendResetEmail({ email, firstName, actionLink, year });

    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[ResetPassword API] Unexpected error:', err?.message);
    // Still return success to prevent enumeration
    return NextResponse.json({ success: true });
  }
}

async function sendResetEmail({
  email,
  firstName,
  actionLink,
  year,
}: {
  email: string;
  firstName: string;
  actionLink: string;
  year: number;
}) {
  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT) || 465;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const fromEmail = process.env.EMAIL_FROM || 'hola@teolabs.app';
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pagnol.teolabs.app';

  if (!host || !user || !pass) {
    console.error('[ResetPassword API] Email no enviado: variables EMAIL_* no configuradas.');
    throw new Error('SMTP no configurado.');
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

  await transporter.sendMail({
    from: `"PAGNOL" <${fromEmail}>`,
    to: email,
    subject: `Recupera tu acceso a Pagnol`,
    headers: { 'Importance': 'high' },
    html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recupera tu contraseña</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;border-radius:20px 20px 0 0;padding:32px 40px 24px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Sistema de Gestión Operativa</p>
              <h1 style="margin:0;font-size:30px;font-weight:900;letter-spacing:-1px;color:#ffffff;text-transform:uppercase;">PAGNOL</h1>
              <div style="width:36px;height:3px;background:#f97316;margin:12px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Recuperación de contraseña</p>
              <h2 style="margin:0 0 18px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.25;">
                Hola, ${firstName}<br/>
                <span style="color:#f97316;">Restablece tu acceso</span>
              </h2>

              <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.7;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en Pagnol.<br/>
                Si no fuiste tú, ignora este correo — tu contraseña <strong style="color:#0f172a;">no cambiará</strong>.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <a href="${actionLink}"
                       style="display:inline-block;background-color:#f97316;color:#ffffff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;box-shadow:0 8px 20px rgba(249,115,22,0.30);">
                      Restablecer Contraseña
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Warning box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px 24px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">Importante</p>
                    <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#92400e;line-height:1.8;">
                      <li>El enlace expira en <strong>1 hora</strong></li>
                      <li>Solo puede usarse <strong>una vez</strong></li>
                      <li>Si no solicitaste este cambio, <strong>ignora este correo</strong></li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:<br/>
                <a href="${actionLink}" style="color:#f97316;word-break:break-all;font-size:11px;">${actionLink}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">
                © ${year} TeoLabs — Infraestructura de Gestión
              </p>
              <p style="margin:0;font-size:10px;color:#e2e8f0;">
                hola@teolabs.app &bull; ${appUrl}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
    text: `Hola ${firstName},\n\nRecibimos una solicitud para restablecer tu contraseña en Pagnol.\n\nHaz clic en el siguiente enlace para restablecerla (válido por 1 hora):\n${actionLink}\n\nSi no solicitaste esto, ignora este correo.\n\n© ${year} TeoLabs — hola@teolabs.app`,
  });
}
