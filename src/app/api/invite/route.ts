
import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
    try {
        const { email, role, token, tenantName, invitedByName } = await request.json();

        const host = process.env.EMAIL_HOST;
        const port = Number(process.env.EMAIL_PORT) || 465;
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_PASS;
        const fromEmail = process.env.EMAIL_FROM || user;
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pagnol.teolabs.app';

        if (!host || !user || !pass) {
            console.error("Missing email configuration env variables.");
            return NextResponse.json({
                error: 'Configuración de correo no encontrada en el servidor.',
                details: 'Asegúrate de configurar EMAIL_HOST, EMAIL_USER y EMAIL_PASS.'
            }, { status: 500 });
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

        const inviteLink = `${appUrl}/invite/${token}`;

        const roleLabel: Record<string, string> = {
            administrador: 'Administrador',
            panolero: 'Pañolero',
            supervisor: 'Supervisor',
            operador: 'Operador',
            guardia: 'Guardia',
            'jefe-turno': 'Jefe de Turno',
            'jefe-mantencion': 'Jefe de Mantención',
            finance: 'Finanzas',
            cphs: 'CPHS',
            contratista: 'Contratista',
        };
        const roleDisplay = roleLabel[role] || role?.toUpperCase() || 'Usuario';

        const mailOptions = {
            from: `"PAGNOL" <${fromEmail}>`,
            to: email,
            subject: `Fuiste invitado a ${tenantName || 'Pagnol'} — Acepta tu acceso`,
            headers: {
                'X-Entity-Ref-ID': token,
                'Importance': 'high',
            },
            html: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invitación Pagnol</title>
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

              <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Tienes una nueva invitación</p>
              <h2 style="margin:0 0 28px;font-size:24px;font-weight:900;color:#0f172a;letter-spacing:-0.5px;line-height:1.2;">
                Únete a <span style="color:#f97316;">${tenantName || 'Pagnol'}</span>
              </h2>

              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
                <strong style="color:#0f172a;">${invitedByName || 'Un administrador'}</strong> te ha invitado a colaborar en la plataforma de gestión operativa de <strong style="color:#0f172a;">${tenantName || 'Pagnol'}</strong>.
              </p>

              <!-- Role badge -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 20px;">
                    <p style="margin:0 0 3px;font-size:9px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">Tu rol asignado</p>
                    <p style="margin:0;font-size:17px;font-weight:900;color:#f97316;letter-spacing:-0.3px;">${roleDisplay}</p>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>
                  <td align="center">
                    <a href="${inviteLink}"
                       style="display:inline-block;background-color:#f97316;color:#ffffff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;box-shadow:0 8px 20px rgba(249,115,22,0.35);">
                      Aceptar Invitación
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Link fallback -->
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
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">
                © ${new Date().getFullYear()} TeoLabs — Infraestructura de Gestión
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
        };

        await transporter.sendMail(mailOptions);
        return NextResponse.json({ success: true, message: 'Correo enviado correctamente.' });

    } catch (error: any) {
        console.error('Error sending email:', error);
        return NextResponse.json({
            error: 'Error al enviar el correo.',
            details: error.message
        }, { status: 500 });
    }
}
