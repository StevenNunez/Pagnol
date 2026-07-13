import { NextResponse } from 'next/server';
import { sendEmail, isEmailConfigured } from '@/modules/core/lib/email';
import { renderEmailLayout } from '@/modules/core/lib/emailLayout';
import { supabaseAdmin } from '@/modules/core/lib/admin';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

export async function POST(request: Request) {
    try {
        if (!(await rateLimitByIp(request, 'feedback', 20, 3600))) {
            return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
        }

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
        const alertTo = process.env.FEEDBACK_ALERT_TO || 'contacto@pagnol.cl';

        if (isEmailConfigured()) {
            const shortDesc = description.length > 80
                ? description.slice(0, 80) + '...'
                : description;

            const screenshotHtml = image
                ? `<div style="margin-top:8px;">
                    <p style="margin:0 0 10px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Captura adjunta</p>
                    <img src="${image}" alt="Screenshot" style="width:100%;border-radius:12px;border:1px solid #e2e8f0;" />
                  </div>`
                : '';

            const bodyHtml = `
              <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Nuevo feedback recibido</p>
              <h2 style="margin:0 0 24px;font-size:22px;font-weight:900;color:#0f172a;">🔔 ${shortDesc}</h2>

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

              <p style="margin:0 0 10px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Mensaje</p>
              <div style="background:#fff7ed;border-left:4px solid #f97316;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:8px;">
                <p style="margin:0;font-size:15px;color:#1e293b;line-height:1.7;">${description.replace(/\n/g, '<br/>')}</p>
              </div>
              ${screenshotHtml}
            `;

            const alertHtml = renderEmailLayout({
                eyebrow: 'Sistema de Alertas',
                bodyHtml,
                footerNote: `Recibido el ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`,
            });

            await sendEmail({
                fromName: 'PAGNOL Alerts',
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
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
