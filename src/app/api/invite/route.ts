
import { NextResponse } from 'next/server';
import type { UserRole } from '@/modules/core/lib/data';
import { sendEmail, isEmailConfigured } from '@/modules/core/lib/email';
import { renderEmailLayout, emailButton } from '@/modules/core/lib/emailLayout';
import { ROLES } from '@/modules/core/lib/permissions';
import { requireAuth, hasPermission } from '@/modules/core/lib/api-auth';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

export async function POST(request: Request) {
    try {
        // Enviar invitaciones = crear usuarios: mismo permiso que /api/users/create.
        // Sin esto, la ruta era un relay de correo abierto (phishing con branding Pagnol).
        const auth = await requireAuth(request);
        if (!auth.ok) return auth.response;
        if (!hasPermission(auth.ctx, 'users:create')) {
            return NextResponse.json({ error: 'No autorizado para enviar invitaciones.' }, { status: 403 });
        }

        if (!(await rateLimitByIp(request, 'invite', 30, 3600))) {
            return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
        }

        const { email, role, token, tenantName, invitedByName } = await request.json();

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';

        if (!isEmailConfigured()) {
            console.error("Missing email configuration env variables.");
            return NextResponse.json({
                error: 'Configuración de correo no encontrada en el servidor.',
            }, { status: 500 });
        }

        const inviteLink = `${appUrl}/invite/${token}`;

        const roleDisplay = ROLES[role as UserRole]?.label || role?.toUpperCase() || 'Usuario';

        const bodyHtml = `
              <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Tienes una nueva invitación</p>
              <h2 style="margin:0 0 28px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.2;">
                Únete a <span style="color:#f97316;">${tenantName || 'Pagnol'}</span>
              </h2>

              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
                <strong style="color:#0f172a;">${invitedByName || 'Un administrador'}</strong> te ha invitado a colaborar en la plataforma de gestión operativa de <strong style="color:#0f172a;">${tenantName || 'Pagnol'}</strong>.
              </p>

              <table cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 20px;">
                    <p style="margin:0 0 3px;font-size:9px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">Tu rol asignado</p>
                    <p style="margin:0;font-size:17px;font-weight:900;color:#f97316;letter-spacing:-0.3px;">${roleDisplay}</p>
                  </td>
                </tr>
              </table>

              ${emailButton(inviteLink, 'Aceptar Invitación')}

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-bottom:12px;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Si el botón no funciona, copia este enlace:</p>
                    <p style="margin:0;font-size:11px;color:#3b82f6;word-break:break-all;">${inviteLink}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6;">
                Este enlace es de <strong>uso único</strong> y expirará en <strong>48 horas</strong>.<br/>
                Si no esperabas esta invitación, puedes ignorar este correo de forma segura.
              </p>
        `;

        await sendEmail({
            to: email,
            subject: `Fuiste invitado a ${tenantName || 'Pagnol'} — Acepta tu acceso`,
            headers: {
                'X-Entity-Ref-ID': token,
                'Importance': 'high',
            },
            html: renderEmailLayout({ bodyHtml }),
        });
        return NextResponse.json({ success: true, message: 'Correo enviado correctamente.' });

    } catch (error: any) {
        console.error('Error sending email:', error);
        return NextResponse.json({ error: 'Error al enviar el correo.' }, { status: 500 });
    }
}
