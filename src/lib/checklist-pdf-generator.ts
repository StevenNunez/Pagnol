
'use client';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { AssignedSafetyTask, User } from '@/modules/core/lib/data';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const COLORS = {
  primary: '#1A5276',
  secondary: '#7f8c8d',
  text: '#2c3e50',
  lightGray: '#f8f9f9',
  border: '#d5d8dc',
  white: '#ffffff',
  green: '#27ae60',
  red: '#c0392b',
};

const MARGIN = 15;
const LINE_HEIGHT = 6;

const formatDate = (date: Date | string | undefined | null, includeTime = false) => {
  if (!date) return 'N/A';
  const jsDate = date instanceof Date ? date : new Date(date as any);
  const formatString = includeTime ? "d 'de' MMMM, yyyy HH:mm" : "d 'de' MMMM, yyyy";
  return format(jsDate, formatString, { locale: es });
};

async function getBase64FromUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return '';
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject('');
      reader.readAsDataURL(blob);
    });
  } catch {
    return '';
  }
}

function addHeader(doc: jsPDF, checklist: AssignedSafetyTask, logo?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoSize = 25;
  const topY = 8; // Ajustado para que el logo esté más arriba

  // --- Logo ---
  if (logo) doc.addImage(logo, 'PNG', MARGIN, topY, logoSize, logoSize);

  // --- Código y Revisión (una debajo de otra) ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const rightX = pageWidth - MARGIN;
  doc.setTextColor(COLORS.text);
  doc.text('Código: FA-OA-000', rightX, topY + 6, { align: 'right' });
  doc.text('Revisión: 01', rightX, topY + 12, { align: 'right' });

  // --- Título centrado ---
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('INFORME DE CHECKLIST DE SEGURIDAD', pageWidth / 2, 20, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(COLORS.text);
  doc.text(checklist.templateTitle, pageWidth / 2, 28, { align: 'center' });

  // Línea decorativa
  doc.setDrawColor(COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, 34, pageWidth - MARGIN, 34);
}

function addFooter(doc: jsPDF) {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.getHeight();
    const footerY = pageHeight - 8;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor('#95a5a6');

    doc.text(formatDate(new Date()), MARGIN, footerY);
    doc.text(`Página ${i} de ${totalPages}`, pageWidth - MARGIN, footerY, { align: 'right' });

    const devText = 'desarrollado por ';
    const brand = 'teolabs.app';
    const textWidth = doc.getTextWidth(devText + brand);
    const x = (pageWidth - textWidth) / 2;

    doc.text(devText, x, footerY);
    doc.setTextColor(COLORS.primary);
    doc.textWithLink(brand, x + doc.getTextWidth(devText), footerY, { url: 'https://teolabs.app' });
  }
}

function addChecklistInfo(doc: jsPDF, checklist: AssignedSafetyTask, supervisor?: User, apr?: User) {
  let y = 40;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const getStatusInSpanish = (status: string) => {
    switch (status) {
      case 'approved': return 'Aprobado';
      case 'rejected': return 'Rechazado';
      case 'completed': return 'Completado (Para Revisión)';
      case 'assigned': return 'Asignado';
      default: return status;
    }
  };

  const reviewerName = apr?.name || (checklist.reviewedBy as any)?.name || 'Pendiente';

  const info = [
    ['Obra/Proyecto:', checklist.area || 'No especificada'],
    ['Fecha Completado:', formatDate(checklist.completedAt, true)],
    ['Realizado por:', supervisor?.name || 'No especificado'],
    ['Revisado por:', reviewerName],
    ['Estado:', getStatusInSpanish(checklist.status)],
  ];

  info.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLORS.primary);
    doc.text(label, MARGIN, y + i * LINE_HEIGHT);
    doc.setFont('helvetica', 'normal');
    const statusColor =
      label === 'Estado:' && checklist.status === 'approved' ? COLORS.green :
        label === 'Estado:' && checklist.status === 'rejected' ? COLORS.red :
          COLORS.text;
    doc.setTextColor(statusColor);
    doc.text(value as string, MARGIN + 45, y + i * LINE_HEIGHT);
    doc.setTextColor(COLORS.text); // Reset color
  });

  return y + info.length * LINE_HEIGHT + 6;
}

export async function generateChecklistPDF(checklist: AssignedSafetyTask, users: User[], supervisor?: User, apr?: User) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logo = await getBase64FromUrl('/logo.png');

  addHeader(doc, checklist, logo);
  let y = addChecklistInfo(doc, checklist, supervisor, apr);

  // --- Tabla de ítems ---
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(COLORS.primary);
  doc.setFontSize(11);
  doc.text('Ítems Verificados', MARGIN, y);
  y += 2;

  const tableRows = (checklist.items || []).map((item: any, i: number) => {
    const respuesta = item.yes ? 'Sí' : item.no ? 'No' : 'N/A';
    const responsable = users.find(u => u.id === item.responsibleUserId)?.name || 'N/A';
    return [i + 1, item.element, respuesta, responsable, formatDate(item.completionDate)];
  });

  doc.autoTable({
    head: [['#', 'Elementos que inspeccionar', 'Resp.', 'Responsable Ejecución', 'Fecha']],
    body: tableRows,
    startY: y + 3,
    theme: 'striped',
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white },
    alternateRowStyles: { fillColor: COLORS.lightGray },
    styles: { fontSize: 8.5, cellPadding: 1.8 },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 85 },
      2: { cellWidth: 10, halign: 'center' },
      3: { cellWidth: 40 },
      4: { cellWidth: 25, halign: 'center' },
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // --- Observaciones ---
  if (y > pageHeight - 60) { doc.addPage(); y = MARGIN + 5; }
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(COLORS.primary);
  doc.text('Observaciones del Supervisor', MARGIN, y);
  y += LINE_HEIGHT;
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(COLORS.text);
  const obsText = checklist.observations || 'Sin observaciones.';
  const obsLines = doc.splitTextToSize(obsText, pageWidth - MARGIN * 2);
  doc.text(obsLines, MARGIN, y);
  y += obsLines.length * 4 + 8;

  // --- Evidencias ---
  if (checklist.evidencePhotos?.length) {
    if (y > pageHeight - 80) { doc.addPage(); y = MARGIN + 10; }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(COLORS.primary);
    doc.text('Evidencia Fotográfica', MARGIN, y);
    y += LINE_HEIGHT;

    let x = MARGIN;
    for (const photoUrl of checklist.evidencePhotos) {
      const img = await getBase64FromUrl(photoUrl);
      if (!img) continue;
      if (x > pageWidth - MARGIN - 65) { x = MARGIN; y += 55; }
      if (y > pageHeight - 70) { doc.addPage(); y = MARGIN + 10; }
      doc.addImage(img, 'JPEG', x, y, 60, 45);
      x += 65;
    }
    y += 55;
  }

  // --- Firmas ---
  if (y > pageHeight - 70) { doc.addPage(); y = MARGIN + 10; }
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(COLORS.primary);
  doc.setFontSize(11);
  doc.text('Firmas', pageWidth / 2, y, { align: 'center' });
  y += LINE_HEIGHT + 2;

  const sigWidth = 65;
  const sigHeight = 28;
  const leftX = MARGIN + 5;
  const rightX = pageWidth - MARGIN - sigWidth - 5;

  const addSignature = async (label: string, imgUrl: string | undefined | null, name: string, date: Date | null, x: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label, x + sigWidth / 2, y, { align: 'center' });

    const img = imgUrl ? await getBase64FromUrl(imgUrl) : '';
    if (img) {
      doc.addImage(img, 'PNG', x, y + 2, sigWidth, sigHeight);
    } else {
      doc.rect(x, y + 2, sigWidth, sigHeight);
      doc.setFontSize(8);
      doc.setTextColor(COLORS.secondary);
      doc.text('Sin firma', x + sigWidth / 2, y + sigHeight / 2 + 2, { align: 'center' });
      doc.setTextColor(COLORS.text);
    }

    const lineY = y + sigHeight + 6;
    doc.line(x, lineY, x + sigWidth, lineY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(name || 'N/A', x + sigWidth / 2, lineY + 4, { align: 'center' });
    doc.text(formatDate(date, true), x + sigWidth / 2, lineY + 8, { align: 'center' });
  };

  await addSignature('Realizado por:', checklist.performedBy?.signature, supervisor?.name || 'N/A', checklist.completedAt || null, leftX);
  await addSignature('Revisado por (APR):', (checklist.reviewedBy as any)?.signature, apr?.name || 'N/A', (checklist.reviewedBy as any)?.date || null, rightX);

  addFooter(doc);

  const filename = `Checklist_${checklist.templateTitle.replace(/[^a-zA-Z0-9]/g, '_')}_${formatDate(checklist.createdAt as any)}.pdf`;
  doc.save(filename);
}
