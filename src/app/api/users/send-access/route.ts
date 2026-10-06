import { NextResponse } from 'next/server';
import { requireAuth, resolveTenant } from '@/modules/core/lib/api-auth';
import { isEmailConfigured, sendEmail } from '@/modules/core/lib/email';
import { renderEmailLayout, emailButton } from '@/modules/core/lib/emailLayout';
import { checkRateLimit } from '@/modules/core/lib/rate-limit';

// Envía a usuarios de la empresa un correo de "activa tu acceso": para qué es
// Pagnol, cómo se entra y un botón a "¿Olvidó su clave?" con su correo ya
// escrito. No lleva el enlace de recuperación dentro, porque ese vence en una
// hora: cada uno lo pide cuando se sienta a hacerlo. Sirve para poner en
// marcha una empresa nueva o antes de una inducción.
//
// Sólo administrador o soporte, sólo a usuarios de SU empresa (los ids de
// otra empresa se ignoran en silencio), y con tope de envíos por hora.

const MAX_RECIPIENTS = 100;
const MAX_NOTE = 800;

const esc = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string
));

export async function POST(request: Request) {
    try {
        const auth = await requireAuth(request, { roles: ['administrador', 'soporte-pagnol'] });
        if (!auth.ok) return auth.response;
        const { ctx } = auth;

        if (!isEmailConfigured()) {
            return NextResponse.json({ error: 'El correo (SMTP) no está configurado.' }, { status: 500 });
        }
        if (!(await checkRateLimit(`users-send-access:${ctx.userId}`, 10, 3600))) {
            return NextResponse.json({ error: 'Demasiados envíos en la última hora. Intenta más tarde.' }, { status: 429 });
        }

        const body = await request.json().catch(() => ({}));
        const tenantId = resolveTenant(ctx, body.tenantId);
        const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.filter((x: unknown) => typeof x === 'string') : [];
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, MAX_NOTE) : '';
        if (!tenantId) return NextResponse.json({ error: 'Empresa no válida.' }, { status: 400 });
        if (!userIds.length) return NextResponse.json({ error: 'Elige al menos un usuario.' }, { status: 400 });
        if (userIds.length > MAX_RECIPIENTS) {
            return NextResponse.json({ error: `Máximo ${MAX_RECIPIENTS} usuarios por envío.` }, { status: 400 });
        }

        const admin = ctx.admin;
        const [{ data: targets, error: tErr }, { data: sender }, { data: tenant }] = await Promise.all([
            admin.from('profiles').select('id, name, email, is_active, deleted_at')
                .eq('tenant_id', tenantId).in('id', userIds),
            admin.from('profiles').select('name, email').eq('id', ctx.userId).single(),
            admin.from('tenants').select('name, logo_url').eq('id', tenantId).single(),
        ]);
        if (tErr) throw tErr;

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';
        const company = esc(tenant?.name) || 'tu empresa';
        const senderName = esc(sender?.name) || 'El administrador';
        const noteHtml = note
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;"><tr><td style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:18px 22px;">
                 <p style="margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:3px;color:#64748b;text-transform:uppercase;">Mensaje de ${senderName}</p>
                 <p style="margin:0;font-size:14px;color:#334155;line-height:1.7;">${esc(note).replace(/\n/g, '<br/>')}</p>
               </td></tr></table>`
            : '';
        const logoHtml = tenant?.logo_url
            ? `<img src="${esc(tenant.logo_url)}" alt="${company}" style="max-height:40px;max-width:200px;margin-bottom:16px" />`
            : `<p style="margin:0 0 16px;font-size:15px;font-weight:800;color:#0f172a;">${company}</p>`;

        const sent: string[] = [];
        const skipped: { name: string; reason: string }[] = [];
        const failed: { name: string; reason: string }[] = [];

        for (const t of targets ?? []) {
            if (t.deleted_at || t.is_active === false) { skipped.push({ name: t.name, reason: 'usuario inactivo' }); continue; }
            if (!t.email) { skipped.push({ name: t.name, reason: 'sin correo' }); continue; }

            const firstName = esc(String(t.name ?? '').split(' ')[0]) || 'Hola';
            const resetUrl = `${appUrl}/reset-password?email=${encodeURIComponent(t.email)}`;
            const bodyHtml = `
                ${logoHtml}
                <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:3px;color:#94a3b8;text-transform:uppercase;">Activa tu acceso</p>
                <h2 style="margin:0 0 18px;font-size:24px;font-weight:900;color:#0f172a;">
                  Hola, ${firstName}<br/><span style="color:#f97316;">deja tu acceso a Pagnol listo</span>
                </h2>
                <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
                  ${company} usa Pagnol para controlar los activos, los retiros y las devoluciones del pañol.
                  ${senderName} te pide que dejes tu acceso funcionando. Toma dos minutos.
                </p>
                ${noteHtml}
                ${emailButton(resetUrl, 'Crear mi contraseña')}
                <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                  <tr><td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:20px 24px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:800;letter-spacing:3px;color:#9a3412;text-transform:uppercase;">Cómo se hace</p>
                    <ol style="margin:0;padding:0 0 0 18px;font-size:13px;color:#92400e;line-height:1.8;">
                      <li>Pulsa <strong>Crear mi contraseña</strong>: se abre Pagnol con tu correo ya escrito. Pulsa enviar.</li>
                      <li>Te llega otro correo de Pagnol (revisa también Spam). Ábrelo <strong>dentro de la hora</strong> y crea tu contraseña.</li>
                      <li>Entra a <strong>www.pagnol.cl</strong> con tu correo <strong>${esc(t.email)}</strong> (o tu RUT) y esa contraseña.</li>
                    </ol>
                  </td></tr>
                </table>
                <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.6;">
                  ¿Dudas? Responde este correo y le llega a ${senderName}.
                </p>`;
            try {
                await sendEmail({
                    to: t.email,
                    subject: `Activa tu acceso a Pagnol — ${tenant?.name ?? 'Pagnol'}`,
                    replyTo: sender?.email || undefined,
                    text:
                        `Hola ${String(t.name ?? '').split(' ')[0]},\n\n` +
                        `${tenant?.name ?? 'Tu empresa'} usa Pagnol para controlar los activos y el pañol. ` +
                        `${sender?.name ?? 'El administrador'} te pide dejar tu acceso listo.\n\n` +
                        (note ? `${note}\n\n` : '') +
                        `1. Abre ${resetUrl} y pulsa enviar.\n` +
                        `2. Abre el correo que te llega (dentro de la hora) y crea tu contraseña.\n` +
                        `3. Entra a www.pagnol.cl con ${t.email} (o tu RUT) y esa contraseña.\n`,
                    html: renderEmailLayout({ eyebrow: 'Acceso a Pagnol', bodyHtml }),
                });
                sent.push(t.name);
            } catch (e: any) {
                console.error('[users/send-access] envío a', t.id, e?.message);
                failed.push({ name: t.name, reason: 'no se pudo enviar' });
            }
        }

        return NextResponse.json({ sent, skipped, failed });
    } catch (err: any) {
        console.error('[users/send-access]', err);
        return NextResponse.json({ error: 'No se pudo completar el envío.' }, { status: 500 });
    }
}
