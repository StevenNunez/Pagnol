// Envoltorio único para todos los correos de Pagnol: header oscuro con el
// wordmark + acento naranja, tarjeta blanca para el contenido de cada ruta, y
// footer con el link a www.pagnol.cl. Antes cada ruta (invitación, bienvenida,
// reset, feedback, ERP, OC/cotización, informe de terreno) duplicaba este
// boilerplate con headers/footers ligeramente distintos entre sí.

export function renderEmailLayout(opts: { eyebrow?: string; bodyHtml: string; footerNote?: string }): string {
  const { eyebrow = 'Sistema de Gestión Operativa', bodyHtml, footerNote } = opts;
  const year = new Date().getFullYear();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://www.pagnol.cl';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Pagnol</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">

          <!-- Header -->
          <tr>
            <td style="background-color:#0f172a;border-radius:20px 20px 0 0;padding:36px 40px 28px;text-align:center;">
              <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:4px;color:#f97316;text-transform:uppercase;">${eyebrow}</p>
              <h1 style="margin:0;font-size:32px;font-weight:900;letter-spacing:-1px;color:#ffffff;text-transform:uppercase;">PAGNOL</h1>
              <div style="width:40px;height:3px;background:#f97316;margin:14px auto 0;border-radius:2px;"></div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:44px 40px 36px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#f8fafc;border-radius:0 0 20px 20px;border-top:1px solid #e2e8f0;padding:24px 40px;text-align:center;">
              ${footerNote ? `<p style="margin:0 0 10px;font-size:11px;color:#94a3b8;line-height:1.5;">${footerNote}</p>` : ''}
              <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:2px;color:#cbd5e1;text-transform:uppercase;">© ${year} TeoLabs — Infraestructura de Gestión</p>
              <p style="margin:0;font-size:11px;">
                <a href="${appUrl}" style="color:#f97316;text-decoration:none;font-weight:700;">www.pagnol.cl</a>
                <span style="color:#cbd5e1;"> &bull; </span>
                <span style="color:#94a3b8;">contacto@pagnol.cl</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Botón CTA naranja estándar — aparece igual en invitación, bienvenida, reset, etc. */
export function emailButton(href: string, label: string): string {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
    <tr>
      <td align="center">
        <a href="${href}" style="display:inline-block;background-color:#f97316;color:#ffffff;text-decoration:none;padding:18px 44px;border-radius:14px;font-size:13px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;box-shadow:0 8px 20px rgba(249,115,22,0.35);">
          ${label}
        </a>
      </td>
    </tr>
  </table>`;
}
