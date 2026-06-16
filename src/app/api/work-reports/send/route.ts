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

export async function POST(request: NextRequest) {
  try {
    const caller = await verifySession(request);
    if (!caller) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    }

    if (!(await rateLimitByIp(request, 'work-report-send', 20, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta mas tarde.' }, { status: 429 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'SMTP no configurado.' }, { status: 500 });
    }

    const { to, subject, message, pdfBase64, filename, reportCode } = await request.json();
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [];
    if (recipients.length === 0 || !pdfBase64) {
      return NextResponse.json({ error: 'Destinatarios y PDF son obligatorios.' }, { status: 400 });
    }

    const content = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64');

    await sendEmail({
      fromName: 'PAGNOL - Informes de Terreno',
      to: recipients.join(','),
      subject: subject || `Informe de terreno ${reportCode || ''}`.trim(),
      html: `
        <div style="font-family:Arial,sans-serif;color:#1f2937">
          <h2 style="margin:0 0 12px">Informe de terreno ${reportCode || ''}</h2>
          <p>${message || 'Se adjunta informe de terreno generado desde Pagnol.'}</p>
        </div>
      `,
      attachments: [{
        filename: filename || `informe-terreno-${reportCode || 'reporte'}.pdf`,
        content,
        contentType: 'application/pdf',
      }],
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[WorkReports] send error:', error);
    return NextResponse.json({ error: 'Error interno enviando el informe.' }, { status: 500 });
  }
}
