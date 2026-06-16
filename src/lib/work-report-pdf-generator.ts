import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Tenant, WorkReport } from '@/modules/core/lib/data';
import {
  WORK_REPORT_STATUS_LABEL as STATUS_LABEL,
  WORK_EXECUTION_LABEL as EXECUTION_LABEL,
} from '@/modules/core/lib/work-report-labels';

const M = 14;

async function toDataUrl(url?: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function header(doc: jsPDF, report: WorkReport, tenant?: Tenant | null) {
  const w = doc.internal.pageSize.getWidth();
  const companyName = tenant?.name?.toUpperCase() || 'PAGNOL';
  doc.setFillColor(32, 74, 87);
  doc.rect(0, 0, w, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(`${companyName} - INFORME DE TERRENO`, M, 12);
  doc.setFontSize(8);
  doc.text(`Codigo: ${report.internalCode}`, M, 19);
  doc.text(`Emision: ${new Date().toLocaleDateString('es-CL')}`, w - M, 12, { align: 'right' });
  doc.text(tenant?.name || 'PAGNOL', w - M, 19, { align: 'right' });
  doc.setTextColor(0, 0, 0);
}

function footer(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Pagina ${i} de ${pages}`, w - M, h - 8, { align: 'right' });
  }
}

export async function generateWorkReportPdf(report: WorkReport, tenant?: Tenant | null): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  header(doc, report, tenant);

  autoTable(doc, {
    startY: 34,
    theme: 'grid',
    head: [['Datos generales', '']],
    body: [
      ['Numero OT', report.otNumber || '-'],
      ['Cliente', report.client || '-'],
      ['Faena / Area', `${report.faena || '-'} / ${report.area || '-'}`],
      ['Supervisor', report.supervisorName || '-'],
      ['Fecha trabajo', report.workDate ? new Date(report.workDate as any).toLocaleDateString('es-CL') : '-'],
      ['Horario', `${report.startTime || '-'} a ${report.endTime || '-'}`],
      ['Ubicacion', report.location || '-'],
      ['Estado reporte', STATUS_LABEL[report.status] || report.status],
      ['Avance', `${report.progressPercent}% - ${EXECUTION_LABEL[report.executionStatus] || report.executionStatus}`],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [32, 74, 87] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } },
  });

  const y1 = (doc as any).lastAutoTable.finalY + 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Actividades ejecutadas', M, y1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(report.activities || '-', 180), M, y1 + 6);

  autoTable(doc, {
    startY: y1 + 28,
    theme: 'striped',
    head: [['Personal', 'Cargo', 'HH']],
    body: (report.labor || []).map((l) => [l.name, l.role, String(l.hours || 0)]),
    foot: [['Total', `${report.labor?.length || 0} trabajadores`, String((report.labor || []).reduce((s, l) => s + Number(l.hours || 0), 0))]],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [241, 90, 36] },
  });

  doc.addPage();
  header(doc, report, tenant);
  autoTable(doc, {
    startY: 34,
    theme: 'striped',
    head: [['Equipo', 'Tipo', 'HM', 'Actividad']],
    body: (report.equipment || []).map((e) => [e.equipment, e.type, String(e.hours || 0), e.activity]),
    foot: [['Total', '', String((report.equipment || []).reduce((s, e) => s + Number(e.hours || 0), 0)), '']],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [32, 74, 87] },
  });

  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 10,
    theme: 'striped',
    head: [['Material', 'Unidad', 'Cantidad']],
    body: (report.materials || []).map((m) => [m.material, m.unit, String(m.quantity || 0)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [32, 74, 87] },
  });

  const signaturesY = (doc as any).lastAutoTable.finalY + 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Firmas digitales', M, signaturesY);
  const signatures = report.signatures || [];
  for (let i = 0; i < Math.min(signatures.length, 3); i += 1) {
    const sig = signatures[i];
    const x = M + i * 62;
    if (sig.signature) doc.addImage(sig.signature, 'PNG', x, signaturesY + 4, 42, 16);
    doc.setFontSize(7);
    doc.text(sig.userName, x, signaturesY + 25);
    doc.text(sig.action, x, signaturesY + 29);
  }

  const photos = report.photos || [];
  for (let i = 0; i < photos.length; i += 2) {
    doc.addPage();
    header(doc, report, tenant);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Registro fotografico', M, 34);

    for (let j = 0; j < 2 && i + j < photos.length; j += 1) {
      const photo = photos[i + j];
      const y = 42 + j * 105;
      const img = await toDataUrl(photo.url);
      if (img) doc.addImage(img, 'JPEG', M, y, 86, 64);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Foto ${i + j + 1}`, 106, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(doc.splitTextToSize(photo.description || '-', 82), 106, y + 11);
      doc.text(`Fecha: ${new Date(photo.date).toLocaleString('es-CL')}`, 106, y + 34);
      doc.text(`Usuario: ${photo.userName}`, 106, y + 40);
    }
  }

  footer(doc);
  return doc;
}
