import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/modules/core/lib/admin';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { user_id, user_name, user_email, tenant_id, description, image, url } = body;

        if (!description?.trim()) {
            return NextResponse.json({ error: 'Descripción requerida.' }, { status: 400 });
        }

        // 1. Guardar en base de datos
        const { error: dbError } = await supabaseAdmin.from('feedbacks').insert({
            user_id,
            user_name,
            user_email,
            tenant_id,
            description,
            image,
            created_at: new Date().toISOString(),
            status: 'pending',
            url,
        });

        if (dbError) throw dbError;

        // 2. Enviar alerta por email (no bloquea si falla)
        const host = process.env.EMAIL_HOST;
        const port = Number(process.env.EMAIL_PORT) || 465;
        const user = process.env.EMAIL_USER;
        const pass = process.env.EMAIL_PASS;
        const fromEmail = process.env.EMAIL_FROM || user;
        const alertTo = process.env.FEEDBACK_ALERT_TO || 'hola@teolabs.app';

        if (host && user && pass) {
            const transporter = nodemailer.createTransport({
                host,
                port,
                secure: port === 465,
                auth: { user, pass },
                tls: { rejectUnauthorized: false },
            });

            const shortDesc = description.length > 80
                ? description.slice(0, 80) + '...'
                : description;

            const screenshotHtml = image
                ? `<tr><td style="padding:0 40px 32px;">
                    <p style="margin:0 0 10px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Captura adjunta</p>
                    <img src="${image}" alt="Screenshot" style="width:100%;border-radius:12px;border:1px solid #e2e8f0;" />
                  </td></tr>`
                : '';

            const alertHtml = `<!DOCTYPE html>
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
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">Sistema de Alertas</p>
              <h1 style="margin:0;font-size:22px;font-weight:900;color:#ffffff;text-transform:uppercase;letter-spacing:-0.5px;">🔔 Nuevo Feedback Recibido</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:36px 40px 28px;">
              <!-- User info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:14px;padding:18px 20px;margin-bottom:28px;">
                <tr>
                  <td>
                    <p style="margin:0 0 3px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Usuario</p>
                    <p style="margin:0 0 12px;font-size:15px;font-weight:700;color:#0f172a;">${user_name || 'Anónimo'}</p>
                    <p style="margin:0 0 3px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Correo</p>
                    <p style="margin:0 0 12px;font-size:13px;color:#3b82f6;">${user_email || '—'}</p>
                    <p style="margin:0 0 3px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Página</p>
                    <p style="margin:0;font-size:11px;color:#64748b;word-break:break-all;">${url || '—'}</p>
                  </td>
                </tr>
              </table>

              <!-- Description -->
              <p style="margin:0 0 10px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Mensaje</p>
              <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:28px;">
                <p style="margin:0;font-size:15px;color:#1e293b;line-height:1.7;">${description.replace(/\n/g, '<br/>')}</p>
              </div>
            </td>
          </tr>

          ${screenshotHtml}

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
                from: `"PAGNOL Alerts" <${fromEmail}>`,
                to: alertTo,
                subject: `🔔 Feedback: ${shortDesc}`,
                html: alertHtml,
            }).catch(err => {
                // Loguear pero no fallar — el feedback ya está guardado en DB
                console.error('[Feedback] Error enviando alerta por email:', err.message);
            });
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('[Feedback] Error:', error);
        return NextResponse.json({ error: error.message || 'Error interno.' }, { status: 500 });
    }
}
