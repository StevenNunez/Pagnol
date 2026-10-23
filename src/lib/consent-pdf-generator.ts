import jsPDF from 'jspdf';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  consentParagraphs, CONSENT_VERSION,
  electronicDocsParagraphs, ELECTRONIC_DOCS_CONSENT_VERSION,
} from '@/modules/core/lib/biometric-consent';

/**
 * Formato impreso del consentimiento, para que lo firme el trabajador.
 *
 * Dos autorizaciones separadas, cada una con su «sí» y su «no»:
 *   1. Datos biométricos (Ley 21.719): el texto es EXACTAMENTE el de la app
 *      (`consentParagraphs`), no una copia. Si se corrigiera uno y no el otro, lo
 *      que firmó en papel dejaría de coincidir con lo que acepta en pantalla.
 *   2. Documentos electrónicos y firma electrónica (Dictamen DT 789/15): exige
 *      consentimiento expreso, y que quien no acepte reciba todo en papel. Pide
 *      además el correo PARTICULAR (no el institucional) donde llegará la copia.
 *
 * El «no» de cada una es real: el consentimiento sólo es libre si negarse tiene
 * una salida. El texto de la sección 2 es nuevo y debe revisarlo asesoría legal.
 */

const COLORS = {
  primary: '#1A5276',
  secondary: '#7f8c8d',
  text: '#2c3e50',
  border: '#aab2bd',
};
const MARGIN = 18;

async function toDataUrl(url: string): Promise<string> {
  if (!url) return '';
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

/** «Teo Labs» con cada letra de un color del degradado azul → morado → verde. */
function drawTeoLabsCredit(doc: jsPDF, centerX: number, y: number) {
  const name = 'Teo Labs';
  const stops = [[37, 99, 235], [168, 85, 247], [34, 197, 94]]; // blue-600, purple-500, green-500
  const colorAt = (t: number) => {
    const seg = t < 0.5 ? 0 : 1;
    const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    return stops[seg].map((c, i) => Math.round(c + (stops[seg + 1][i] - c) * u));
  };
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  const lead = 'Desarrollado por ';
  const tail = ' ®';
  doc.setFont('helvetica', 'bold');
  const nameW = doc.getTextWidth(name);
  doc.setFont('helvetica', 'normal');
  const total = doc.getTextWidth(lead) + nameW + doc.getTextWidth(tail);
  let x = centerX - total / 2;

  doc.setTextColor(COLORS.secondary);
  doc.text(lead, x, y);
  x += doc.getTextWidth(lead);

  doc.setFont('helvetica', 'bold');
  const nameStart = x;
  [...name].forEach((ch, i) => {
    const [r, g, b] = colorAt(i / (name.length - 1));
    doc.setTextColor(r, g, b);
    doc.text(ch, x, y);
    x += doc.getTextWidth(ch);
  });
  doc.link(nameStart, y - 3, nameW, 4, { url: 'https://www.teolabs.app' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(COLORS.secondary);
  doc.text(tail, x, y);
}

export interface ConsentPdfOptions {
  empresa: { name: string; rut?: string; address?: string; logoUrl?: string; representante?: string };
  /** Sin trabajador = formato en blanco para imprimir y llenar a mano. */
  worker?: { name: string; rut?: string } | null;
}

export async function generateConsentPdf({ empresa, worker }: ConsentPdfOptions): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = 0;

  const ensure = (needed: number) => {
    if (y + needed > pageH - 22) { doc.addPage(); y = MARGIN; }
  };

  const paragraph = (text: string, size = 9.5, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(COLORS.text);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const line of lines) {
      ensure(5);
      doc.text(line, MARGIN, y);
      y += 4.6;
    }
    y += 1.8;
  };

  const heading = (text: string) => {
    ensure(14);
    y += 2;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(COLORS.primary);
    doc.text(text, MARGIN, y);
    y += 2;
    doc.setDrawColor(COLORS.primary);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, pageW - MARGIN, y);
    y += 6;
  };

  const fieldLine = (label: string, value?: string) => {
    ensure(9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(COLORS.secondary);
    doc.text(label, MARGIN, y);
    const x0 = MARGIN + doc.getTextWidth(label) + 3;
    doc.setDrawColor(COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(x0, y + 0.8, pageW - MARGIN, y + 0.8);
    if (value) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(COLORS.text);
      doc.text(value, x0 + 1, y - 0.2);
    }
    y += 8;
  };

  const checkbox = (text: string) => {
    ensure(8);
    doc.setDrawColor(COLORS.text);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y - 3.4, 4, 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(COLORS.text);
    const lines = doc.splitTextToSize(text, contentW - 8) as string[];
    lines.forEach((l, i) => { doc.text(l, MARGIN + 7, y + i * 4.6); });
    y += lines.length * 4.6 + 2.5;
  };

  // ── Encabezado ─────────────────────────────────────────────────────────────
  y = 10;
  const logo = await toDataUrl(empresa.logoUrl || '/logo.png');
  if (logo) {
    try { doc.addImage(logo, logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG', MARGIN, y, 22, 22); }
    catch { /* un logo roto no debe impedir el documento */ }
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(COLORS.secondary);
  doc.text(`Biometría v${CONSENT_VERSION} · Documentos electrónicos v${ELECTRONIC_DOCS_CONSENT_VERSION}`, pageW - MARGIN, y + 4, { align: 'right' });
  doc.setFontSize(14);
  doc.setTextColor(COLORS.primary);
  doc.text('AUTORIZACIÓN INFORMADA DEL TRABAJADOR', pageW / 2 + 8, y + 12, { align: 'center' });
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(COLORS.text);
  doc.text('Datos biométricos y uso de medios electrónicos', pageW / 2 + 8, y + 18, { align: 'center' });
  y += 28;
  doc.setDrawColor(COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  y += 8;

  // ── Partes ─────────────────────────────────────────────────────────────────
  fieldLine('Empresa:', empresa.name);
  if (empresa.rut) fieldLine('RUT de la empresa:', empresa.rut);
  fieldLine('Nombre del trabajador:', worker?.name);
  fieldLine('RUT del trabajador:', worker?.rut);

  // ── 1. Biometría ───────────────────────────────────────────────────────────
  heading('1. Datos biométricos');
  for (const p of consentParagraphs(empresa.name)) paragraph(p);
  y += 1;
  checkbox('SÍ autorizo el tratamiento de mis datos biométricos en los términos descritos.');
  checkbox('NO autorizo. Me identificaré por otro medio que disponga la empresa, sin que ello afecte mi relación laboral.');

  // ── 2. Documentos electrónicos ─────────────────────────────────────────────
  heading('2. Documentos y firma electrónicos');
  for (const p of electronicDocsParagraphs(empresa.name)) paragraph(p);
  y += 1;
  // El correo y las dos casillas van juntos: separados, la firma queda sin su contexto.
  ensure(34);
  fieldLine('Correo electrónico particular:');
  checkbox('SÍ autorizo el uso de medios electrónicos para mis documentos laborales.');
  checkbox('NO autorizo. Recibiré y firmaré mis documentos en papel.');

  // ── Firmas ─────────────────────────────────────────────────────────────────
  ensure(60);
  y += 6;
  fieldLine('Lugar y fecha:', format(new Date(), "d 'de' MMMM 'de' yyyy", { locale: es }));
  y += 14;
  const colW = (contentW - 12) / 2;
  doc.setDrawColor(COLORS.text);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + colW, y);
  doc.line(MARGIN + colW + 12, y, pageW - MARGIN, y);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(COLORS.text);
  doc.text('Firma del trabajador', MARGIN + colW / 2, y + 5, { align: 'center' });
  doc.text('Por la empresa', MARGIN + colW + 12 + colW / 2, y + 5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(COLORS.secondary);
  doc.text(worker?.name ? `${worker.name}${worker.rut ? ' · ' + worker.rut : ''}` : 'Nombre y RUT', MARGIN + colW / 2, y + 9.5, { align: 'center' });
  doc.text(empresa.representante || 'Nombre y cargo', MARGIN + colW + 12 + colW / 2, y + 9.5, { align: 'center' });

  // ── Pie de cada página ─────────────────────────────────────────────────────
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const fy = pageH - 9;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(COLORS.secondary);
    doc.text(empresa.address ? `${empresa.name} · ${empresa.address}` : empresa.name, MARGIN, fy);
    doc.text(`Página ${i} de ${pages}`, pageW - MARGIN, fy, { align: 'right' });
    drawTeoLabsCredit(doc, pageW / 2, fy + 4.5);
  }

  const safe = (worker?.name || 'formato-en-blanco').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
  doc.save(`autorizacion-trabajador-${safe}.pdf`);
}
