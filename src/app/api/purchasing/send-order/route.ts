import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, hasPermission } from '@/modules/core/lib/api-auth';
import type { Permission } from '@/modules/core/lib/permissions';
import { isEmailConfigured, sendEmail } from '@/modules/core/lib/email';
import { renderEmailLayout } from '@/modules/core/lib/emailLayout';
import { checkRateLimit, rateLimitByIp } from '@/modules/core/lib/rate-limit';

// Envía por correo la solicitud de cotización / orden de compra (PDF) directamente
// al proveedor, sin que el comprador tenga que descargar y redactar un correo aparte.
//
// El correo sale de la casilla de Pagnol (contacto@pagnol.cl), así que este endpoint NO
// puede ser un reenviador abierto. Reglas:
//  - sólo quien compra o arrienda (permiso de Compras/Arriendos), de una cuenta activa;
//  - quién envía y desde qué empresa lo decide el SERVIDOR (perfil y empresa del llamante):
//    lo que el cliente mande como nombre, correo, empresa o logo se ignora;
//  - el adjunto tiene que ser un PDF real, con tope de tamaño; pocos destinatarios;
//  - tipo de documento de una lista cerrada y tope por usuario además del de IP.

// Cualquiera de estos habilita el envío de cotizaciones y OC (quien compra o arrienda).
const SEND_PERMISSIONS: Permission[] = ['purchase_requests:approve', 'rentals:manage_quotes', 'rentals:manage_contracts'];
// La solicitud de suministro al cliente la envía quien creó la solicitud (p. ej. un
// supervisor), que desde su historial ve el botón «Enviar al cliente»: ahí basta con crear.
const SUPPLY_SEND_PERMISSIONS: Permission[] = [...SEND_PERMISSIONS, 'purchase_requests:create'];
const SUPPLY_LABEL = 'Solicitud de suministro';
const FULL_ACCESS_ROLES = ['administrador', 'soporte-pagnol'];

const DOC_LABELS = [
  'Solicitud de cotización',
  'Solicitud de cotización de arriendo',
  'Orden de Compra de arriendo',
  SUPPLY_LABEL,
];
const MAX_RECIPIENTS = 5;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_MESSAGE = 2000;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string
));
/** Una sola línea, sin saltos: lo que va a un encabezado de correo no puede traer CR/LF. */
const oneLine = (s: unknown, max: number) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.ok) return auth.response;
    const { ctx } = auth;
    const admin = ctx.admin;

    // `requireAuth` no mira si la cuenta sigue activa: aquí sí, porque este endpoint
    // habla en nombre de la empresa hacia afuera.
    const { data: me } = await admin
      .from('profiles')
      .select('name, email, phone, cargo, is_active, deleted_at')
      .eq('id', ctx.userId)
      .single();
    if (!me || me.deleted_at || me.is_active === false || !ctx.tenantId) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    // El tipo de documento se lee antes de decidir: cambia qué permiso alcanza.
    const body = await request.json().catch(() => ({}));
    const { to, subject, message, pdfBase64, filename, orderCode, docLabel } = body ?? {};
    const needed = docLabel === SUPPLY_LABEL ? SUPPLY_SEND_PERMISSIONS : SEND_PERMISSIONS;

    let allowed = ctx.isSuperAdmin
      || FULL_ACCESS_ROLES.includes(ctx.role)
      || needed.some((p) => hasPermission(ctx, p));
    if (!allowed) {
      // Roles propios de la empresa (tabla `roles`): mismo criterio que `can()` en el cliente.
      const { data: roleRow } = await admin
        .from('roles').select('permissions').eq('id', ctx.role).eq('tenant_id', ctx.tenantId).maybeSingle();
      const perms: unknown[] = Array.isArray(roleRow?.permissions) ? roleRow.permissions : [];
      allowed = needed.some((p) => perms.includes(p));
    }
    if (!allowed) return NextResponse.json({ error: 'No tienes permiso para enviar correos de compras.' }, { status: 403 });

    if (!(await rateLimitByIp(request, 'purchasing-send-order', 30, 3600))
      || !(await checkRateLimit(`purchasing-send-order:user:${ctx.userId}`, 30, 3600))) {
      return NextResponse.json({ error: 'Demasiados intentos. Intenta más tarde.' }, { status: 429 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'El correo (SMTP) no está configurado.' }, { status: 500 });
    }

    const recipients = [...new Set(
      (Array.isArray(to) ? to : to ? [to] : []).map((x: unknown) => String(x ?? '').trim().toLowerCase()).filter(Boolean),
    )] as string[];
    if (recipients.length === 0 || !pdfBase64) {
      return NextResponse.json({ error: 'Destinatario y PDF son obligatorios.' }, { status: 400 });
    }
    if (recipients.length > MAX_RECIPIENTS) {
      return NextResponse.json({ error: `Máximo ${MAX_RECIPIENTS} destinatarios por envío.` }, { status: 400 });
    }
    const invalid = recipients.find((r) => !EMAIL_RE.test(r) || r.length > 254);
    if (invalid) return NextResponse.json({ error: `El correo "${oneLine(invalid, 60)}" no es válido.` }, { status: 400 });

    const content = Buffer.from(String(pdfBase64).replace(/^data:application\/pdf;base64,/, ''), 'base64');
    if (content.length === 0 || content.subarray(0, 5).toString('latin1') !== '%PDF-') {
      return NextResponse.json({ error: 'El adjunto no es un PDF válido.' }, { status: 400 });
    }
    if (content.length > MAX_PDF_BYTES) {
      return NextResponse.json({ error: 'El PDF pesa demasiado (máximo 10 MB).' }, { status: 413 });
    }

    // Quién envía y desde qué empresa: del servidor, nunca del cuerpo de la petición.
    const { data: tenant } = await admin.from('tenants').select('name, logo_url').eq('id', ctx.tenantId).single();
    const company = esc(tenant?.name) || 'Pagnol';
    const label = esc(DOC_LABELS.includes(docLabel) ? docLabel : DOC_LABELS[0]);
    const code = oneLine(orderCode, 40);
    const senderName = me.name || undefined;
    const senderEmail = me.email || undefined;
    const senderPhone = me.phone || undefined;
    const senderRole = me.cargo || undefined;

    // "De parte de" la empresa: logo si existe, si no su nombre — dentro de la
    // misma tarjeta Pagnol, en vez de reemplazar el header de marca.
    const senderCompanyHtml = tenant?.logo_url
      ? `<img src="${esc(tenant.logo_url)}" alt="${company}" style="max-height:40px;max-width:200px;margin-bottom:16px" />`
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

    const text = oneLine(message, MAX_MESSAGE);
    const bodyHtml = `
          <p style="margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">${label}</p>
          ${senderCompanyHtml}
          <h2 style="margin:0 0 16px;font-size:20px;font-weight:900;color:#0f172a;">${label} ${esc(code)}</h2>
          <p style="margin:0 0 8px;font-size:15px;color:#475569;line-height:1.6;">${esc(text) || 'Estimado proveedor, adjuntamos nuestra solicitud. Quedamos atentos a su respuesta.'}</p>
          <p style="margin:0;color:#94a3b8;font-size:13px;">Encontrará el detalle en el PDF adjunto.</p>
          ${contactHtml}
    `;

    // Nombre del adjunto: sin rutas ni caracteres raros, siempre .pdf.
    const safeName = oneLine(filename, 120).replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, '') || `cotizacion-${code || 'oc'}`;

    await sendEmail({
      fromName: 'PAGNOL - Abastecimiento',
      replyTo: senderEmail,
      to: recipients.join(','),
      subject: oneLine(subject, 150) || `${DOC_LABELS.includes(docLabel) ? docLabel : DOC_LABELS[0]} ${code}`.trim(),
      html: renderEmailLayout({
        eyebrow: 'Abastecimiento',
        bodyHtml,
        footerNote: `Enviado por ${company} a través de Pagnol.`,
      }),
      attachments: [{
        filename: `${safeName}.pdf`,
        content,
        contentType: 'application/pdf',
      }],
    });

    // Rastro de quién envió a quién: queda en los registros del servidor.
    console.info('[Purchasing] send-order', { user: ctx.userId, tenant: ctx.tenantId, to: recipients, doc: label, code });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[Purchasing] send-order error:', error);
    return NextResponse.json({ error: 'Error interno enviando la cotización.' }, { status: 500 });
  }
}
