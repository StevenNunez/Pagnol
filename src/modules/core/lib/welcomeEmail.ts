import { sendEmail, isEmailConfigured } from '@/modules/core/lib/email';
import { renderEmailLayout, emailButton } from '@/modules/core/lib/emailLayout';

// Correo de bienvenida al registrar un tenant nuevo. Compartido entre
// /api/register (email+password) y /api/register/oauth (Google) — antes cada
// ruta tenía su propia copia casi idéntica del HTML.
export async function sendWelcomeEmail({ adminName, adminEmail, tenantName, viaGoogle }: {
  adminName: string;
  adminEmail: string;
  tenantName: string;
  viaGoogle?: boolean;
}) {
  if (!isEmailConfigured()) {
    console.warn('[Welcome email] omitido: variables EMAIL_* no configuradas.');
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';
  const firstName = adminName.split(' ')[0];

  const intro = viaGoogle
    ? `Registraste tu empresa con tu cuenta de Google. Ahora eres el <strong style="color:#0f172a;">Administrador</strong> de la plataforma y tienes acceso completo para configurar tu equipo y comenzar a operar.<br/><br/>Puedes seguir iniciando sesión con el botón <strong>"Continuar con Google"</strong> en la página de login.`
    : `Tu organización fue registrada exitosamente. Ahora eres el <strong style="color:#0f172a;">Administrador</strong> de la plataforma y tienes acceso completo para configurar tu equipo y comenzar a operar.`;

  const bodyHtml = `
    <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Registro exitoso</p>
    <h2 style="margin:0 0 20px;font-size:26px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.2;">
      ¡Hola, ${firstName}!<br/>
      <span style="color:#f97316;">${tenantName}</span> ya está en Pagnol
    </h2>
    <p style="margin:0 0 28px;font-size:15px;color:#475569;line-height:1.7;">${intro}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="background:#f8fafc;border-radius:16px;padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:10px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Próximos pasos recomendados</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0"><tr><td style="width:28px;font-size:16px;">1.</td><td style="font-size:14px;color:#0f172a;font-weight:700;">Completa el onboarding inicial</td></tr></table>
                <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Configura los roles clave de tu organización</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #e2e8f0;">
                <table cellpadding="0" cellspacing="0"><tr><td style="width:28px;font-size:16px;">2.</td><td style="font-size:14px;color:#0f172a;font-weight:700;">Invita a tu equipo</td></tr></table>
                <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Agrega administradores, supervisores y operadores</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 0;">
                <table cellpadding="0" cellspacing="0"><tr><td style="width:28px;font-size:16px;">3.</td><td style="font-size:14px;color:#0f172a;font-weight:700;">Registra tus activos y materiales</td></tr></table>
                <p style="margin:2px 0 0 28px;font-size:12px;color:#64748b;">Empieza a trazabilizar todo desde el módulo Pagnol</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${emailButton(`${appUrl}/dashboard`, 'Ir a mi Panel')}

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr>
        <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:10px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">¿Necesitas ayuda?</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:6px 0;">
                <p style="margin:0;font-size:13px;color:#0f172a;font-weight:700;">📧 Soporte por correo</p>
                <p style="margin:2px 0 0;font-size:12px;color:#64748b;">contacto@pagnol.cl — respondemos en menos de 24 hrs hábiles</p>
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
  `;

  await sendEmail({
    to: adminEmail,
    subject: `¡Bienvenido a Pagnol, ${firstName}! Tu organización está lista`,
    headers: { Importance: 'high' },
    html: renderEmailLayout({ bodyHtml }),
  });
}
