
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { DailyTalk, User } from '@/modules/core/lib/data';
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
  white: '#ffffff'
};

const MARGIN = 15;
const LINE_HEIGHT = 6;

const formatDate = (date: Date | string | undefined | null) => {
  if (!date) return 'N/A';
  return format(new Date(date as any), "d 'de' MMMM, yyyy", { locale: es });
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
  doc.text('Código: FA-OA-002', pageWidth - MARGIN, topY + 6, { align: 'right' });
  doc.text('Revisión: 01', pageWidth - MARGIN, topY + 12, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('REGISTRO DE CHARLA DIARIA', pageWidth / 2, topY + 12, { align: 'center' });

  doc.setDrawColor(COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, headerSectionEndY, pageWidth - MARGIN, headerSectionEndY);
  
  return headerSectionEndY;
}

function addFooter(doc: jsPDF) {
    const pageCount = (doc.internal as any).getNumberOfPages();
    const pageWidth = doc.internal.pageSize.getWidth();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pageHeight = doc.internal.pageSize.getHeight();
        const footerY = pageHeight - 8;
        doc.setFontSize(8);
        doc.setTextColor(COLORS.secondary);
        doc.text(formatDate(new Date()), MARGIN, footerY);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - MARGIN, footerY, { align: 'right' });

        const devText = 'desarrollado por ';
        const brand = 'teolabs.app';
        const textWidth = doc.getTextWidth(devText + brand);
        const x = (pageWidth - textWidth) / 2;
        doc.text(devText, x, footerY);
        doc.setTextColor(COLORS.primary);
        doc.textWithLink(brand, x + doc.getTextWidth(devText), footerY, { url: 'https://teolabs.app' });
    }
}

export async function generateDailyTalkPDF(talk: DailyTalk, users: User[]) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const logo = await getBase64FromUrl('/logo.png');
  
  const userMap = new Map(users.map(u => [u.id, u]));

  let y = addHeader(doc, logo);

  doc.autoTable({
    body: [
      ['Obra:', talk.obra],
      ['Fecha:', formatDate(talk.fecha)],
      ['Expositor:', talk.expositorName],
    ],
    startY: y + 2,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 2, textColor: COLORS.text, lineWidth: 0.1 },
    columnStyles: { 0: { fontStyle: 'bold', fillColor: COLORS.lightGray, cellWidth: 35 } },
  });
  
  y = (doc as any).lastAutoTable.finalY + 8;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Temas Tratados:', MARGIN, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  const temasLines = doc.splitTextToSize(talk.temas, pageWidth - MARGIN * 2);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, temasLines.length * 4 + 4);
  doc.text(temasLines, MARGIN + 2, y + 4);
  y += temasLines.length * 4 + 10;
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Asistentes:', MARGIN, y);
  y += 2;
  
  const assistantsData = talk.asistentes.map((asistente, i) => {
    const user = userMap.get(asistente.id);
    return [
      i + 1,
      asistente.name,
      user?.cargo || 'N/A',
      asistente.rut || 'N/A',
      '', // Dejamos la celda de firma vacía para dibujarla después
    ]
  });

  const signatureImages: { [key: number]: string } = {};
  for (let i = 0; i < talk.asistentes.length; i++) {
    const asistente = talk.asistentes[i];
    if (asistente.signature) {
      signatureImages[i] = await getBase64FromUrl(asistente.signature);
    }
  }
  
  doc.autoTable({
      head: [['N°', 'Nombre Completo', 'Cargo', 'RUT', 'Firma']],
      body: assistantsData,
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: COLORS.primary, textColor: COLORS.white },
      styles: { fontSize: 9, cellPadding: 2, minCellHeight: 12, valign: 'middle' },
      columnStyles: {
          0: { cellWidth: 10, halign: 'center' },
          1: { cellWidth: 60 },
          2: { cellWidth: 30 },
          3: { cellWidth: 30 },
          4: { cellWidth: 38, halign: 'center' },
      },
      didDrawCell: (data: { column: { index: number; }; cell: { section: string; x: number; y: number; width: number; height: number; }; row: { index: number; }; }) => {
        if (data.column.index === 4 && data.cell.section === 'body') {
            const signatureImg = signatureImages[data.row.index];
            if (signatureImg) {
                const imgWidth = 25;
                const imgHeight = 10;
                const x = data.cell.x + (data.cell.width - imgWidth) / 2;
                const y = data.cell.y + (data.cell.height - imgHeight) / 2;
                doc.addImage(signatureImg, 'PNG', x, y, imgWidth, imgHeight);
            }
        }
    }
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  if (y > pageHeight - 100) { doc.addPage(); y = MARGIN + 5; }

  const sigWidth = 70;
  const sigHeight = 28;

  if(talk.foto) {
    const foto = await getBase64FromUrl(talk.foto);
    if(foto) {
        doc.setFont('helvetica', 'bold');
        doc.text('Evidencia Fotográfica:', MARGIN, y);
        y += 5;
        doc.addImage(foto, 'PNG', MARGIN, y, 90, 60);
        y += 65;
    }
  }

  if (y > pageHeight - 50) { doc.addPage(); y = MARGIN + 5; }

  const sigY = y;
  const sigX = pageWidth / 2 - sigWidth / 2;
  doc.setFont('helvetica', 'bold');
  doc.text('Firma Expositor', sigX + sigWidth/2, sigY, { align: 'center'});
  const firmaImg = await getBase64FromUrl(talk.firma);
  if(firmaImg) {
    doc.addImage(firmaImg, 'PNG', sigX, sigY + 2, sigWidth, sigHeight);
  }
  const lineY = sigY + sigHeight + 4;
  doc.line(sigX, lineY, sigX + sigWidth, lineY);
  doc.text(talk.expositorName, sigX + sigWidth / 2, lineY + 5, { align: 'center' });

  addFooter(doc);
  
  const talkDate = new Date(talk.fecha as any);
  const filename = `Charla_Diaria_${format(talkDate, 'yyyy-MM-dd')}.pdf`;
  doc.save(filename);
}
