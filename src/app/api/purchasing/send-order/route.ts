import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isEmailConfigured, sendEmail } from '@/modules/core/lib/email';
import { renderEmailLayout } from '@/modules/core/lib/emailLayout';
import { rateLimitByIp } from '@/modules/core/lib/rate-limit';

async function verifySession(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data: { user }, error } = await client.auth.getUser(token);
  return error || !user ? null : user;
}

// Envía por correo la solicitud de cotización / orden de compra (PDF) directamente
// al proveedor, sin que el comprador tenga que descargar y redactar un correo aparte.
export async function POST(request: NextRequest) {
  try {
    const caller = await verifySession(request);
    if (!caller) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    if (!(await rateLimitByIp(request, 'purchasing-send-order', 30, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'El correo (SMTP) no está configurado.' }, { status: 500 });
    }

    const {
      to, subject, message, pdfBase64, filename, orderCode,
      // Datos opcionales para dar protagonismo al tenant y permitir que el
      // proveedor sepa a quién responder (reply-to + bloque de contacto).
      companyName, companyLogoUrl, senderName, senderEmail, senderPhone, senderRole,
      docLabel,
    } = await request.json();
    const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
    if (recipients.length === 0 || !pdfBase64) {
      return NextResponse.json({ error: 'Destinatario y PDF son obligatorios.' }, { status: 400 });
    }

    const content = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64');

    const esc = (s: any) => String(s ?? '').replace(/[<>&"]/g, (c) => (
      { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string
    ));
    const company = esc(companyName) || 'Pagnol';
    const label = esc(docLabel) || 'Solicitud de cotización';

    // "De parte de" el tenant: logo si existe, si no su nombre — dentro de la
    // misma tarjeta Pagnol, en vez de reemplazar el header de marca.
    const senderCompanyHtml = companyLogoUrl
      ? `<img src="${esc(companyLogoUrl)}" alt="${company}" style="max-height:40px;max-width:200px;margin-bottom:16px" />`
      : `<p style="margin:0 0 16px;font-size:15px;font-weight:800;color:#0f172a;">${company}</p>`;

    // Bloque de contacto: a quién responder (el reply-to apunta al mismo correo).
    const contactRows = [
      senderName ? `<div style="font-weight:600;color:#0f172a">${esc(senderName)}${senderRole ? ` · <span style="font-weight:400;color:#64748b">${esc(senderRole)}</span>` : ''}</div>` : '',
      senderEmail ? `<div>✉️ <a href="mailto:${esc(senderEmail)}" style="color:#f97316;text-decoration:none">${esc(senderEmail)}</a></div>` : '',
      senderPhone ? `<div>📞 ${esc(senderPhone)}</div>` : '',
    ].filter(Boolean).join('');
    const contactHtml = contactRows
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
           <tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;">
             <p style="margin:0 0 6px;font-size:9px;font-weight:800;letter-spacing:2px;color:#94a3b8;text-transform:uppercase;">Para responder, contacta a</p>
             ${contactRows}
           </td></tr>
         </table>`
      : '';

    const bodyHtml = `
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">${label}</p>
          ${senderCompanyHtml}
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#0f172a;">${label} ${esc(orderCode)}</h2>
          <p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.6;">${esc(message) || 'Estimado proveedor, adjuntamos nuestra solicitud. Quedamos atentos a su respuesta.'}</p>
          <p style="margin:0;color:#94a3b8;font-size:13px;">Encontrará el detalle en el PDF adjunto.</p>
          ${contactHtml}
    `;

    await sendEmail({
      fromName: 'PAGNOL - Abastecimiento',
      replyTo: senderEmail || undefined,
      to: recipients.join(','),
      subject: subject || `${label} ${orderCode || ''}`.trim(),
      html: renderEmailLayout({
        eyebrow: 'Abastecimiento',
        bodyHtml,
        footerNote: `Enviado por ${company} a través de Pagnol.`,
      }),
      attachments: [{
        filename: filename || `cotizacion-${orderCode || 'oc'}.pdf`,
        content,
        contentType: 'application/pdf',
      }],
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Purchasing] send-order error:', error);
    return NextResponse.json({ error: 'Error interno enviando la cotización.' }, { status: 500 });
  }
}
