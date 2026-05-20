import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(request: Request) {
    try {
        const { name, company, email, phone, erp, api } = await request.json();

        if (!name || !company || !email || !erp) {
            return NextResponse.json({ error: 'Faltan campos obligatorios.' }, { status: 400 });
        }

        const host = process.env.EMAIL_HOST;
        const port = Number(process.env.EMAIL_PORT) || 465;
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_PASS;
        const fromEmail = process.env.EMAIL_FROM || user;

        if (!host || !user || !pass) {
            return NextResponse.json({ error: 'Configuración de correo no encontrada.' }, { status: 500 });
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

        const apiLabel: Record<string, string> = {
            rest: 'REST API',
            rfc: 'SAP RFC / BAPI',
            sftp: 'SFTP / Archivos planos',
            webhook: 'Webhooks',
            no_se: 'No lo sabe aún',
        };

        const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;border-radius:20px 20px 0 0;padding:28px 40px;text-align:center;">
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Nueva Solicitud</p>
              <h1 style="margin:0;font-size:22px;font-weight:900;color:#ffffff;text-transform:uppercase;letter-spacing:-0.5px;">🔌 Integración ERP</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 40px 32px;">

              <!-- Contact info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:14px;padding:20px 24px;margin-bottom:28px;">
                <tr>
                  <td>
                    <p style="margin:0 0 2px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Nombre</p>
                    <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#0f172a;">${name}</p>
                    <p style="margin:0 0 2px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Empresa</p>
                    <p style="margin:0 0 14px;font-size:15px;font-weight:600;color:#1e293b;">${company}</p>
                    <p style="margin:0 0 2px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Correo</p>
                    <p style="margin:0 0 14px;font-size:13px;color:#3b82f6;">${email}</p>
                    <p style="margin:0 0 2px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Teléfono</p>
                    <p style="margin:0;font-size:13px;color:#475569;">${phone || '—'}</p>
                  </td>
                </tr>
              </table>

              <!-- ERP Details -->
              <p style="margin:0 0 10px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Detalles de integración</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:#fff7ed;border-left:4px solid #f97316;border-radius:0 12px 12px 0;padding:16px 20px;">
                    <p style="margin:0 0 10px;font-size:13px;color:#1e293b;line-height:1.6;">
                      <strong style="color:#0f172a;">ERP:</strong> ${erp}
                    </p>
                    <p style="margin:0;font-size:13px;color:#1e293b;line-height:1.6;">
                      <strong style="color:#0f172a;">Tipo de conexión:</strong> ${api ? apiLabel[api] || api : '—'}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
                Este prospecto llegó desde la página <strong>/pricing</strong> de Pagnol.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">
                PAGNOL — TeoLabs · ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

        await transporter.sendMail({
            from: `"PAGNOL" <${fromEmail}>`,
            to: 'hola@teolabs.app',
            replyTo: email,
            subject: `🔌 Solicitud integración ERP — ${company} (${erp})`,
            html,
        });

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('[ERP Request] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno.' }, { status: 500 });
    }
}
