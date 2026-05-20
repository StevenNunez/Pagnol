
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { BehaviorObservation } from '@/modules/core/lib/data';
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
  amber: '#f39c12'
};

const MARGIN = 15;

const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return 'N/A';
  const jsDate = new Date(date as any);
  return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
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

function addHeader(doc: jsPDF, logo?: string) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const logoSize = 25;
  const topY = 8;
  const headerSectionEndY = topY + logoSize + 2;

  if (logo) doc.addImage(logo, 'PNG', MARGIN, topY, logoSize, logoSize);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(COLORS.text);
  doc.text('Código: FA-OA-001', pageWidth - MARGIN, topY + 6, { align: 'right' });
  doc.text('Revisión: 01', pageWidth - MARGIN, topY + 12, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('REGISTRO DE OBSERVACIÓN DE CONDUCTA', pageWidth / 2, topY + 12, { align: 'center' });

  doc.setDrawColor(COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, headerSectionEndY, pageWidth - MARGIN, headerSectionEndY);
  
  return headerSectionEndY;
}

function addFooter(doc: jsPDF) {
    const totalPages = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        const pageHeight = doc.internal.pageSize.getHeight();
        const footerY = pageHeight - 8;
        doc.setFontSize(8);
        doc.setTextColor(COLORS.secondary);
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

function addObservationInfo(doc: jsPDF, observation: BehaviorObservation, startY: number) {
  const infoData = [
    ['Obra:', observation.obra],
    ['Trabajador Observado:', observation.workerName],
    ['RUT:', observation.workerRut || 'N/A'],
    ['Fecha de Observación:', formatDate(observation.observationDate)],
  ];

  doc.autoTable({
    body: infoData,
    startY: startY + 2,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, textColor: COLORS.text, lineWidth: 0.1 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: COLORS.lightGray, cellWidth: 50 } },
  });

  return (doc as any).lastAutoTable.finalY;
}

export async function generateBehaviorObservationPDF(observation: BehaviorObservation) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const logo = await getBase64FromUrl('/logo.png');

  let y = addHeader(doc, logo);
  y = addObservationInfo(doc, observation, y);

  const tableRows = observation.items.map((item, i) => {
    const status = item.status === 'si' ? 'Sí' : item.status === 'no' ? 'No' : 'N/A';
    return [`${String.fromCharCode(65 + i)}.- ${item.question}`, status];
  });
  
  doc.autoTable({
      head: [['Descripción', 'Estado']],
      body: tableRows,
      startY: y + 5,
      theme: 'striped',
      headStyles: { fillColor: COLORS.primary, textColor: COLORS.white },
      styles: { fontSize: 8.5, cellPadding: 2 },
      columnStyles: { 1: { halign: 'center', cellWidth: 15 } },
  });
  
  y = (doc as any).lastAutoTable.finalY + 10;
  
  const riskLevels: Record<string, string> = {
    aceptable: 'ACEPTABLE',
    leve: 'LEVE',
    grave: 'GRAVE',
    gravisimo: 'GRAVÍSIMO',
  };
  const riskColors: Record<string, string> = {
    aceptable: COLORS.green,
    leve: COLORS.amber,
    grave: COLORS.red,
    gravisimo: COLORS.red,
  };

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('NIVEL DE RIESGO: ', MARGIN, y);
  const riskText = riskLevels[observation.riskLevel || 'aceptable'];
  doc.setTextColor(riskColors[observation.riskLevel || 'aceptable']);
  doc.text(riskText, MARGIN + 40, y);
  doc.setTextColor(COLORS.text);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.text('Retroalimentación:', MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const feedbackLines = doc.splitTextToSize(observation.feedback, pageWidth - MARGIN * 2);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, feedbackLines.length * 4 + 4);
  doc.text(feedbackLines, MARGIN + 2, y + 4);
  y += feedbackLines.length * 4 + 10;

  // Signatures
  const sigWidth = 70;
  const sigHeight = 28;
  const sigY = doc.internal.pageSize.getHeight() - 70;
  y = Math.max(y, sigY - 10);
  
  const addSignature = async (label: string, name: string, signatureImg: string, x: number) => {
    doc.text(label, x + sigWidth / 2, y, { align: 'center' });
    const img = await getBase64FromUrl(signatureImg);
    if(img) {
      doc.addImage(img, 'PNG', x, y + 2, sigWidth, sigHeight);
    }
    const lineY = y + sigHeight + 4;
    doc.line(x, lineY, x + sigWidth, lineY);
    doc.text(name, x + sigWidth / 2, lineY + 5, { align: 'center' });
  };
  
  await addSignature('Firma Observador', observation.observerName, observation.observerSignature, MARGIN + 10);
  await addSignature('Firma Trabajador', observation.workerName, observation.workerSignature, pageWidth - sigWidth - MARGIN - 10);

  addFooter(doc);

  const filename = `Observacion_Conducta_${observation.workerName.replace(/ /g, '_')}_${formatDate(observation.createdAt)}.pdf`;
  doc.save(filename);
}
