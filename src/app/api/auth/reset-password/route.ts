import { NextResponse } from 'next/server';
import { supabase, getSupabaseAdmin } from '@/modules/core/lib/supabase';
import { sendEmail } from '@/modules/core/lib/email';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

export async function POST(request: Request) {
  let email = '';

  try {
    if (!(await rateLimitByIp(request, 'reset-password', 5, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
    }

    const body = await request.json();
    email = (body.email ?? '').toLowerCase().trim();

    if (!email) {
      return NextResponse.json({ error: 'Correo requerido.' }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';
    const redirectTo = `${appUrl}/update-password`;

    // ── Strategy 1: generate link + send via custom SMTP ─────────────────────
    let customEmailSent = false;

    try {
      const admin = getSupabaseAdmin();
      const { data, error: linkError } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo },
      });

      if (linkError || !data?.properties?.action_link) {
        // User might not exist — that's fine, we just don't send
        console.warn('[ResetPassword] generateLink:', linkError?.message ?? 'no link');
      } else {
        const actionLink = data.properties.action_link;
        const firstName = (data.user?.user_metadata?.name as string | undefined)?.split(' ')[0] ?? 'Usuario';
        await sendResetEmail({ email, firstName, actionLink });
        customEmailSent = true;      }
    } catch (smtpErr: any) {
      console.error('[ResetPassword] Custom SMTP failed:', smtpErr.message);
    }

    // ── Strategy 2: fallback to Supabase email ────────────────────────────────
    if (!customEmailSent) {
      try {
        await supabase.auth.resetPasswordForEmail(email, { redirectTo });      } catch (fallbackErr: any) {
        // Supabase may return "rate limit exceeded" or similar — log but don't expose
        console.warn('[ResetPassword] Supabase fallback error:', fallbackErr.message);
      }
    }

    // Always return success to prevent user enumeration
    return NextResponse.json({ success: true });

  } catch (err: any) {
    console.error('[ResetPassword] Unexpected error for', email, ':', err.message);
    return NextResponse.json({ success: true });
  }
}

async function sendResetEmail({
  email,
  firstName,
  actionLink,
}: {
  email: string;
  firstName: string;
  actionLink: string;
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';
  const year = new Date().getFullYear();

  await sendEmail({
    to: email,
    subject: 'Recupera tu acceso a Pagnol',
    headers: { Importance: 'high' },
    text: `Hola ${firstName},\n\nHaz clic en el enlace para restablecer tu contraseña (válido por 1 hora):\n${actionLink}\n\nSi no solicitaste esto, ignora este correo.\n\n© ${year} TeoLabs — contacto@pagnol.cl`,
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      <tr><td style="background:#0f172a;border-radius:20px 20px 0 0;padding:32px 40px 24px;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Sistema de Gestión Operativa</p>
        <h1 style="margin:0;font-size:30px;font-weight:900;letter-spacing:-1px;color:#fff;text-transform:uppercase;">PAGNOL</h1>
        <div style="width:36px;height:3px;background:#f97316;margin:12px auto 0;border-radius:2px;"></div>
      </td></tr>

      <tr><td style="background:#fff;padding:40px 40px 32px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Recuperación de contraseña</p>
        <h2 style="margin:0 0 18px;font-size:24px;font-weight:900;color:#0f172a;">
          Hola, ${firstName}<br/><span style="color:#f97316;">Restablece tu acceso</span>
        </h2>
        <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.7;">
          Recibimos una solicitud para restablecer la contraseña de tu cuenta.<br/>
          Si no fuiste tú, ignora este correo — tu contraseña <strong>no cambiará</strong>.
        </p>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
          <tr><td align="center">
            <a href="${actionLink}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;">
              Restablecer Contraseña
            </a>
          </td></tr>
        </table>

        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px 24px;">
            <p style="margin:0 0 10px;font-size:10px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">Importante</p>
            <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#92400e;line-height:1.8;">
              <li>El enlace expira en <strong>1 hora</strong></li>
              <li>Solo puede usarse <strong>una vez</strong></li>
            </ul>
          </td></tr>
        </table>

        <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
          Si el botón no funciona, copia este enlace en tu navegador:<br/>
          <a href="${actionLink}" style="color:#f97316;word-break:break-all;">${actionLink}</a>
        </p>
      </td></tr>

      <tr><td style="background:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
        <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">
          © ${year} TeoLabs — contacto@pagnol.cl &bull; ${appUrl}
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`,
  });
}
