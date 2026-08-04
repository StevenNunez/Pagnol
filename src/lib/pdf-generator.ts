
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { PurchaseOrder as PurchaseOrderType, PurchaseRequest, Client, Supplier } from '@/modules/core/lib/data';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

async function getBase64FromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}`);
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
      console.error("Error fetching logo:", error);
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
}


const getDate = (date: Date | string) =>
  date instanceof Date ? date : new Date(date as any);

const sanitizeFileName = (name: string) =>
  name.replace(/[^a-zA-Z0-9-_]/g, '_');

export async function generatePurchaseOrderPDF(order: PurchaseOrderType, supplier: Supplier, orderIndex: number, logoUrl?: string) {
  if (!order || !supplier || !order.items) {
    throw new Error('Datos de la orden o proveedor incompletos');
  }

  const COLORS = {
    primary: '#2980b9',
    secondary: '#7f8c8d',
    text: '#34495e',
    lightGray: '#ecf0f1',
    white: '#ffffff',
  };
  const LINE_HEIGHT = 7;

  const logoBase64 = await getBase64FromUrl(logoUrl || '/logo.png');

  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  doc.addImage(logoBase64, 'PNG', margin, y, 20, 20);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('SOLICITUD DE COTIZACIÓN', pageWidth / 2, y + 12, { align: 'center' });
  y += 25;
  
  doc.setDrawColor(COLORS.lightGray);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(COLORS.text);
  doc.text('PAGNOL Asset Management', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text('RUT: 77.123.456-K', margin, y + LINE_HEIGHT - 2);
  doc.text('Av. del Titanio 34, La Serena', margin, y + (LINE_HEIGHT * 2) - 4);
  
  const orderDate = getDate(order.createdAt || new Date());
  
  // Right-aligned info table for Order Number and Date
  autoTable(doc, {
    body: [
        [{ content: 'SOLICITUD N°:', styles: { fontStyle: 'bold', halign: 'right' } }, { content: String(orderIndex).padStart(3, '0'), styles: { halign: 'left' } }],
        [{ content: 'FECHA:', styles: { fontStyle: 'bold', halign: 'right' } }, { content: orderDate.toLocaleDateString('es-CL'), styles: { halign: 'left' } }],
    ],
    startY: y - (LINE_HEIGHT - 2),
    theme: 'plain',
    tableWidth: 'wrap',
    styles: { fontSize: 9, cellPadding: { right: 0, left: 1 } },
    margin: { left: pageWidth - margin - 50 }, // Position the table on the right
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 'auto' } }
  });

  y += LINE_HEIGHT * 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  doc.setFont('helvetica', 'bold');
  doc.text('PROVEEDOR:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(supplier.name, margin + 30, y);

  doc.setFont('helvetica', 'bold');
  doc.text('OBRA:', pageWidth / 2, y);
  doc.setFont('helvetica', 'normal');
  doc.text('Faena Minera "El Peñón"', pageWidth / 2 + 15, y);

  y += LINE_HEIGHT;
  if(supplier.rut) doc.text(`RUT: ${supplier.rut}`, margin + 30, y);
  doc.text('Av. del Cobre s/n, Tierra Amarilla', pageWidth / 2 + 15, y);

  y += LINE_HEIGHT;
  doc.setLineWidth(0.5);
  doc.setDrawColor(COLORS.secondary);
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  const tableColumn = ['Ítem', 'Material', 'Unidad', 'Cantidad'];
  const tableRows = (order.items || []).map((item, index) => [
    index + 1,
    item.name || 'Sin nombre',
    item.unit || 'Sin unidad',
    item.totalQuantity ? item.totalQuantity.toLocaleString('es-CL') : '0',
  ]);

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: y,
    theme: 'grid',
    headStyles: {
      fillColor: COLORS.primary,
      textColor: COLORS.white,
      fontStyle: 'bold',
      halign: 'center',
    },
    styles: {
      fontSize: 9,
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
    },
    columnStyles: {
        0: { halign: 'center', cellWidth: 15 },
        2: { halign: 'center', cellWidth: 20 },
        3: { halign: 'right', cellWidth: 25 },
    },
    didDrawPage: function (data: any) {
        const pageCount = (doc.internal as any).getNumberOfPages();
        // --- FOOTER ---
        doc.setFontSize(8);
        doc.setTextColor(COLORS.secondary);
        doc.text(`Página ${data.pageNumber} de ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
        doc.text(`Documento generado el ${new Date().toLocaleString('es-CL')}`, margin, pageHeight - 10);
        
        const developedByText = 'desarrollado por ';
        const linkText = 'teolabs.app';
        const fullText = developedByText + linkText;
        const textWidth = doc.getTextWidth(fullText);
        const textX = (pageWidth - textWidth) / 2;
        doc.text(developedByText, textX, pageHeight - 10);
        doc.textWithLink(linkText, textX + doc.getTextWidth(developedByText), pageHeight - 10, { url: 'https://teolabs.app' });

        // --- SIGNATURE (only on last page and if items <= 18) ---
        if (data.pageNumber === pageCount && (order.items || []).length <= 18) {
            const signatureY = pageHeight - 40;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(COLORS.text);
            doc.setDrawColor(COLORS.text);
            doc.line(pageWidth / 2 - 40, signatureY, pageWidth / 2 + 40, signatureY);
            doc.text('Firma Autorizada', pageWidth / 2, signatureY + 5, { align: 'center' });
        }
    }
  });

  const safeFilename = `Solicitud_Cotizacion_${String(orderIndex).padStart(3, '0')}_${orderDate.toISOString().split('T')[0]}.pdf`;
  const pdfBlob = doc.output('blob');

  return {
      blob: pdfBlob,
      filename: safeFilename
  };
}

/**
 * PDF "Solicitud de Suministro" al CLIENTE del contrato (caso Valar↔Novandino):
 * documento formal que el supervisor envía por correo cuando el cliente es
 * quien proporciona los materiales. Mismo estilo que la solicitud de
 * cotización, pero identifica al cliente (no a un proveedor) y al contrato.
 */
export async function generateClientSupplyPDF(
  requests: PurchaseRequest[],
  client: Client,
  tenant: { name?: string; rut?: string; address?: string; logoUrl?: string } | null,
  requesterName?: string,
) {
  if (!requests.length) throw new Error('No hay ítems para el documento.');

  const COLORS = {
    primary: '#c2410c',
    secondary: '#7f8c8d',
    text: '#34495e',
    lightGray: '#ecf0f1',
    white: '#ffffff',
  };
  const LINE_HEIGHT = 7;

  const logoBase64 = await getBase64FromUrl(tenant?.logoUrl || '/logo.png');
  const anchor = requests[0];
  const docCode = anchor.internalCode || anchor.id.slice(0, 8).toUpperCase();
  const docDate = getDate(anchor.createdAt || new Date());

  const doc = new jsPDF();
  const pageHeight = doc.internal.pageSize.height || doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.width || doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  doc.addImage(logoBase64, 'PNG', margin, y, 20, 20);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(COLORS.primary);
  doc.text('SOLICITUD DE SUMINISTRO', pageWidth / 2, y + 12, { align: 'center' });
  y += 25;

  doc.setDrawColor(COLORS.lightGray);
  doc.setLineWidth(0.2);
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(COLORS.text);
  doc.text(tenant?.name || 'Pagnol', margin, y);
  doc.setFont('helvetica', 'normal');
  if (tenant?.rut) doc.text(`RUT: ${tenant.rut}`, margin, y + LINE_HEIGHT - 2);
  if (tenant?.address) doc.text(tenant.address, margin, y + (LINE_HEIGHT * 2) - 4);

  autoTable(doc, {
    body: [
      [{ content: 'SOLICITUD N°:', styles: { fontStyle: 'bold', halign: 'right' } }, { content: docCode, styles: { halign: 'left' } }],
      [{ content: 'FECHA:', styles: { fontStyle: 'bold', halign: 'right' } }, { content: docDate.toLocaleDateString('es-CL'), styles: { halign: 'left' } }],
    ],
    startY: y - (LINE_HEIGHT - 2),
    theme: 'plain',
    tableWidth: 'wrap',
    styles: { fontSize: 9, cellPadding: { right: 0, left: 1 } },
    margin: { left: pageWidth - margin - 60 },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { cellWidth: 'auto' } },
  });

  y += LINE_HEIGHT * 2;
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  doc.setFont('helvetica', 'bold');
  doc.text('CLIENTE:', margin, y);
  doc.setFont('helvetica', 'normal');
  doc.text(client.name, margin + 25, y);
  if (anchor.contractName) {
    doc.setFont('helvetica', 'bold');
    doc.text('CONTRATO:', pageWidth / 2, y);
    doc.setFont('helvetica', 'normal');
    doc.text(anchor.contractName, pageWidth / 2 + 25, y);
  }
  y += LINE_HEIGHT;
  if (client.rut) doc.text(`RUT: ${client.rut}`, margin + 25, y);
  if (requesterName) doc.text(`Solicita: ${requesterName}`, pageWidth / 2 + 25, y);
  y += LINE_HEIGHT;

  if (anchor.justification) {
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(COLORS.secondary);
    const lines = doc.splitTextToSize(`Justificación: ${anchor.justification}`, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    doc.setTextColor(COLORS.text);
    doc.setFont('helvetica', 'normal');
    y += lines.length * 5 + 2;
  }

  doc.setLineWidth(0.5);
  doc.setDrawColor(COLORS.secondary);
  doc.line(margin, y, pageWidth - margin, y);
  y += LINE_HEIGHT;

  autoTable(doc, {
    head: [['Ítem', 'Material', 'Unidad', 'Cantidad']],
    body: requests.map((r, i) => [
      i + 1,
      r.materialName || 'Sin nombre',
      r.unit || '—',
      (r.quantity || 0).toLocaleString('es-CL'),
    ]),
    startY: y,
    theme: 'grid',
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold', halign: 'center' },
    styles: { fontSize: 9, cellPadding: 2, lineColor: [200, 200, 200], lineWidth: 0.1 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 15 },
      2: { halign: 'center', cellWidth: 20 },
      3: { halign: 'right', cellWidth: 25 },
    },
    didDrawPage: function (data: any) {
      const pageCount = (doc.internal as any).getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(COLORS.secondary);
      doc.text(`Página ${data.pageNumber} de ${pageCount}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
      doc.text(`Documento generado el ${new Date().toLocaleString('es-CL')}`, margin, pageHeight - 10);
    },
  });

  const afterTableY = (doc as any).lastAutoTable?.finalY || y;
  if (afterTableY < pageHeight - 40) {
    doc.setFontSize(8);
    doc.setTextColor(COLORS.secondary);
    doc.text(
      'Los materiales suministrados por el cliente ingresan como activos del cliente (comodato) y serán restituidos al cierre del contrato.',
      margin,
      afterTableY + 10,
      { maxWidth: pageWidth - margin * 2 },
    );
  }

  const safeFilename = `Solicitud_Suministro_${sanitizeFileName(docCode)}_${docDate.toISOString().split('T')[0]}.pdf`;
  return { blob: doc.output('blob'), filename: safeFilename };
}
