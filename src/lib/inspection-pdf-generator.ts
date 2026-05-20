
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { SafetyInspection, User } from '@/modules/core/lib/data';
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
  amber: '#f39c12',
};

const MARGIN = 15;
const LINE_HEIGHT = 6;

const formatDate = (date: Date | string | undefined | null, includeTime = false) => {
  if (!date) return 'N/A';
  const formatString = includeTime ? "d 'de' MMMM, yyyy HH:mm" : "d 'de' MMMM, yyyy";
  return format(new Date(date as any), formatString, { locale: es });
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

function addHeader(doc: jsPDF, inspection: SafetyInspection, logo?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoSize = 25;
  const topY = 8; // Ajustado para que el logo esté más arriba

  // Logo
  if (logo) doc.addImage(logo, 'PNG', MARGIN, topY, logoSize, logoSize);

  // Código y Revisión (una debajo de otra)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const rightX = pageWidth - MARGIN;
  doc.setTextColor(COLORS.text);
  doc.text('Código: FA-OA-000', rightX, topY + 6, { align: 'right' });
  doc.text('Revisión: 01', rightX, topY + 12, { align: 'right' });

  // Título
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('INFORME DE INSPECCIÓN DE SEGURIDAD', pageWidth / 2, 20, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(COLORS.text);
  doc.text(`Faena: ${inspection.area}`, pageWidth / 2, 28, { align: 'center' });

  // Línea decorativa
  doc.setDrawColor(COLORS.primary);
  doc.setLineWidth(0.6);
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

function addInspectionInfo(doc: jsPDF, inspection: SafetyInspection, supervisor: User, apr: User) {
  let y = 42;
  const getStatusInSpanish = (status: string) => {
    switch (status) {
      case 'open': return 'Abierta';
      case 'in-progress': return 'En Progreso';
      case 'completed': return 'Completada';
      case 'approved': return 'Aprobada';
      case 'rejected': return 'Rechazada';
      default: return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'N/A';
    }
  };

  const getRiskInSpanish = (level: string) => {
    switch (level) {
      case 'leve': return 'Bajo';
      case 'grave': return 'Grave';
      case 'fatal': return 'Crítico / Fatal';
      default: return 'No especificado';
    }
  };

  const tableData = [
    ['Reportado por:', apr?.name || inspection.inspectorName || 'N/A', 'Fecha Reporte:', formatDate(inspection.date)],
    ['Asignado a:', supervisor?.name || 'N/A', 'Plazo Cierre:', formatDate(inspection.deadline)],
    ['Ubicación:', inspection.location || 'N/A', 'Estado:', getStatusInSpanish(inspection.status)],
    ['Nivel de Riesgo:', getRiskInSpanish(inspection.riskLevel), '', ''],
  ];

  doc.autoTable({
    body: tableData,
    startY: y,
    theme: 'grid',
    styles: { fontSize: 9, lineWidth: 0.1, textColor: COLORS.text },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: COLORS.lightGray },
      2: { fontStyle: 'bold', fillColor: COLORS.lightGray },
    },
    didParseCell: function (data: any) {
      if (data.row.index === 3 && data.column.index === 1) { // Celda de Nivel de Riesgo
        data.cell.styles.fontStyle = 'bold';
        switch (inspection.riskLevel) {
          case 'leve':
            data.cell.styles.textColor = COLORS.green;
            break;
          case 'grave':
            data.cell.styles.textColor = COLORS.amber;
            break;
          case 'fatal':
            data.cell.styles.textColor = COLORS.red;
            break;
        }
      }
    }
  });

  return (doc as any).lastAutoTable.finalY + 8;
}

async function addSection(doc: jsPDF, y: number, title: string, content?: string, photos?: string[]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let currentY = y;

  if (currentY > pageHeight - 60) {
    doc.addPage();
    currentY = MARGIN;
  }

  // Section title background
  doc.setFillColor(COLORS.primary);
  doc.rect(MARGIN, currentY - 4, pageWidth - MARGIN * 2, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(COLORS.white);
  doc.text(title, MARGIN + 3, currentY + 1);

  currentY += LINE_HEIGHT + 2;
  doc.setTextColor(COLORS.text);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  if (content) {
    const wrapped = doc.splitTextToSize(content, pageWidth - MARGIN * 2);
    doc.text(wrapped, MARGIN, currentY);
    currentY += wrapped.length * 4 + 5;
  }

  if (photos?.length) {
    currentY += 2;
    let x = MARGIN;
    for (const photoUrl of photos) {
      const img = await getBase64FromUrl(photoUrl);
      if (!img) continue;
      if (x > pageWidth - MARGIN - 65) {
        x = MARGIN;
        currentY += 55;
      }
      if (currentY > pageHeight - 70) {
        doc.addPage();
        currentY = MARGIN;
      }
      doc.addImage(img, 'JPEG', x, currentY, 60, 45);
      x += 65;
    }
    currentY += 55;
  }

  return currentY + 8;
}

async function addSignatures(doc: jsPDF, y: number, inspection: SafetyInspection, supervisor: User, apr: User) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const sigWidth = 70;
  const sigHeight = 28;
  const leftX = MARGIN;
  const rightX = pageWidth - MARGIN - sigWidth;
  let currentY = y;

  if (currentY > 240) {
    doc.addPage();
    currentY = MARGIN + 10;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(COLORS.primary);
  doc.text('Firmas', pageWidth / 2, currentY, { align: 'center' });
  currentY += LINE_HEIGHT + 2;

  const addSignature = async (label: string, img: string | undefined | null, name: string, date: Date | string | null, x: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(label, x + sigWidth / 2, currentY, { align: 'center' });

    const base64 = img ? await getBase64FromUrl(img) : '';
    if (base64) {
      doc.addImage(base64, 'PNG', x, y + 2, sigWidth, sigHeight);
    } else {
      doc.rect(x, currentY + 2, sigWidth, sigHeight);
      doc.setFontSize(8);
      doc.setTextColor(COLORS.secondary);
      doc.text('Sin firma', x + sigWidth / 2, currentY + sigHeight / 2 + 2, { align: 'center' });
      doc.setTextColor(COLORS.text);
    }

    const lineY = currentY + sigHeight + 6;
    doc.line(x, lineY, x + sigWidth, lineY);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(name || 'N/A', x + sigWidth / 2, lineY + 4, { align: 'center' });
    doc.text(formatDate(date, true), x + sigWidth / 2, lineY + 8, { align: 'center' });
  };

  await addSignature('Firma Ejecutor (Cierre)', inspection.completionSignature, supervisor?.name || inspection.completionExecutor || 'N/A', inspection.completedAt || null, leftX);
  await addSignature('Firma Revisor (APR)', inspection.reviewedBy?.signature || null, apr?.name || (inspection.reviewedBy as any)?.name || 'N/A', inspection.reviewedBy?.date || null, rightX);
}

export async function generateInspectionPDF(inspection: SafetyInspection, supervisor: User, apr: User) {
  if (!inspection) throw new Error('Datos de la inspección incompletos.');

  const doc = new jsPDF();
  const logo = await getBase64FromUrl('/logo.png');

  addHeader(doc, inspection, logo);
  let y = addInspectionInfo(doc, inspection, supervisor, apr);

  y = await addSection(doc, y, 'Parte 1: Observación', inspection.description, inspection.evidencePhotos);
  y = await addSection(doc, y, 'Plan de Acción Sugerido', inspection.actionPlan);
  y = await addSection(doc, y, 'Parte 2: Cierre de la Observación', inspection.completionNotes, inspection.completionPhotos);

  if (inspection.status === 'rejected' && inspection.rejectionNotes) {
    y = await addSection(doc, y, 'Notas de Rechazo (Revisor)', inspection.rejectionNotes);
  }

  await addSignatures(doc, y, inspection, supervisor, apr);
  addFooter(doc);

  const safeArea = (inspection.area || 'SinArea').replace(/[^a-zA-Z0-9]/g, '_');
  const filename = `Inspeccion_${safeArea}_${formatDate(inspection.date as any)}.pdf`;
  doc.save(filename);
}
