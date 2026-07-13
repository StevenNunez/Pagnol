import { NextResponse } from 'next/server';
import { sendEmail, isEmailConfigured } from '@/modules/core/lib/email';
import { renderEmailLayout } from '@/modules/core/lib/emailLayout';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

export async function POST(request: Request) {
    try {
        if (!(await rateLimitByIp(request, 'erp-request', 5, 3600))) {
            return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
        }

        const { name, company, email, phone, erp, api } = await request.json();

        if (!name || !company || !email || !erp) {
            return NextResponse.json({ error: 'Faltan campos obligatorios.' }, { status: 400 });
        }

        if (!isEmailConfigured()) {
            return NextResponse.json({ error: 'Configuración de correo no encontrada.' }, { status: 500 });
        }

        const apiLabel: Record<string, string> = {
            rest: 'REST API',
            rfc: 'SAP RFC / BAPI',
            sftp: 'SFTP / Archivos planos',
            webhook: 'Webhooks',
            no_se: 'No lo sabe aún',
        };

        const bodyHtml = `
              <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Nueva solicitud</p>
              <h2 style="margin:0 0 24px;font-size:22px;font-weight:900;color:#0f172a;">🔌 Integración ERP</h2>

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
        `;

        const html = renderEmailLayout({
            eyebrow: 'Nueva Solicitud',
            bodyHtml,
            footerNote: `Recibido el ${new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' })}`,
        });

        await sendEmail({
            to: 'contacto@pagnol.cl',
            replyTo: email,
            subject: `🔌 Solicitud integración ERP — ${company} (${erp})`,
            html,
        });

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('[ERP Request] Error:', error);
        return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
}
