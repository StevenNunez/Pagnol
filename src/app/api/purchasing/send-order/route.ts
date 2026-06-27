import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isEmailConfigured, sendEmail } from '@/modules/core/lib/email';
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

    // Encabezado: logo del tenant si existe, si no su nombre.
    const headerHtml = companyLogoUrl
      ? `<img src="${esc(companyLogoUrl)}" alt="${company}" style="max-height:56px;max-width:220px;margin-bottom:8px" />`
      : `<div style="font-size:20px;font-weight:700;color:#111827;margin-bottom:4px">${company}</div>`;

    // Bloque de contacto: a quién responder (el reply-to apunta al mismo correo).
    const contactRows = [
      senderName ? `<div style="font-weight:600;color:#111827">${esc(senderName)}${senderRole ? ` · <span style="font-weight:400;color:#6b7280">${esc(senderRole)}</span>` : ''}</div>` : '',
      senderEmail ? `<div>✉️ <a href="mailto:${esc(senderEmail)}" style="color:#ea580c;text-decoration:none">${esc(senderEmail)}</a></div>` : '',
      senderPhone ? `<div>📞 ${esc(senderPhone)}</div>` : '',
    ].filter(Boolean).join('');
    const contactHtml = contactRows
      ? `<div style="margin-top:20px;padding:14px 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px">
           <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:6px">Para responder, contacta a</div>
           ${contactRows}
         </div>`
      : '';

    await sendEmail({
      fromName: 'PAGNOL - Abastecimiento',
      replyTo: senderEmail || undefined,
      to: recipients.join(','),
      subject: subject || `${label} ${orderCode || ''}`.trim(),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:560px">
          ${headerHtml}
          <h2 style="margin:8px 0 12px;font-size:18px;color:#111827">${label} ${esc(orderCode)}</h2>
          <p style="line-height:1.5">${esc(message) || 'Estimado proveedor, adjuntamos nuestra solicitud. Quedamos atentos a su respuesta.'}</p>
          <p style="color:#6b7280;font-size:13px">Encontrará el detalle en el PDF adjunto.</p>
          ${contactHtml}
          <p style="color:#9ca3af;font-size:11px;margin-top:20px">Enviado por ${company} a través de Pagnol.</p>
        </div>
      `,
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
