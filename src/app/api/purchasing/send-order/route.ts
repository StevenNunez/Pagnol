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

    const { to, subject, message, pdfBase64, filename, orderCode } = await request.json();
    const recipients = Array.isArray(to) ? to.filter(Boolean) : (to ? [to] : []);
    if (recipients.length === 0 || !pdfBase64) {
      return NextResponse.json({ error: 'Destinatario y PDF son obligatorios.' }, { status: 400 });
    }

    const content = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64');

    await sendEmail({
      fromName: 'PAGNOL - Abastecimiento',
      to: recipients.join(','),
      subject: subject || `Solicitud de cotización ${orderCode || ''}`.trim(),
      html: `
        <div style="font-family:Arial,sans-serif;color:#1f2937">
          <h2 style="margin:0 0 12px">Solicitud de cotización ${orderCode || ''}</h2>
          <p>${message || 'Estimado proveedor, adjuntamos nuestra solicitud de cotización. Quedamos atentos a su respuesta.'}</p>
          <p style="color:#6b7280;font-size:12px;margin-top:16px">Enviado desde Pagnol.</p>
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
