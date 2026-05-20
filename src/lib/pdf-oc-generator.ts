import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { es } from "date-fns/locale";

// --- Tipos e Interfaces ---
interface OCItem {
  item: number;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  netValue: number;
}

interface OCData {
  ocNumber: string;
  date: Date;
  supplierName: string;
  supplierRut: string;
  supplierAddress: string;
  supplierContact: string;
  supplierEmail: string;
  project: string;
  file: string;
  items: OCItem[];
  totalNet: number;
  paymentTerms: string;
  createdByName: string;
  cotizacion?: string;
}

// Extensión de tipos para jsPDF si es necesario
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

// --- Constantes de Estilo ---
const COLORS = {
  primary: '#00528B',     // Azul Ferroactiva
  secondary: '#7f8c8d',   // Gris secundario
  text: '#34495e',        // Texto principal oscuro
  lightGray: '#ecf0f1',   // Fondos claros / bordes
  white: '#ffffff',
  accent: '#2c3e50'
};

const LINE_HEIGHT = 6;
const MARGIN = 15;

// --- Helpers ---

const formatCurrency = (value: number) => `$${Math.round(value).toLocaleString("es-CL")}`;

async function getBase64FromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Network response was not ok`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn("Logo fallback triggered");
    return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  }
}

// --- Función Principal ---

export async function generateOCPDF(data: OCData): Promise<{ blob: Blob; filename: string }> {
  // 1. Configuración Inicial
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = MARGIN;

  // Carga de Logo
  const logoBase64 = await getBase64FromUrl("/logo.png");

  // 2. HEADER
  // Info Empresa (Izquierda)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(COLORS.primary);
  doc.text("PAGNOL ASSET MANAGEMENT", MARGIN, y);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(COLORS.text);
  doc.text("RUT: 77.123.456-K", MARGIN, y + 5);
  doc.text("Av. del Titanio 34, La Serena", MARGIN, y + 9);

  // Logo (Derecha)
  try {
    doc.addImage(logoBase64, "PNG", pageWidth - MARGIN - 40, y - 5, 40, 15);
  } catch (e) { /* ignore */ }
  
  y += 20;

  // 3. TÍTULO PRINCIPAL
  doc.setFillColor(COLORS.primary);
  doc.rect(MARGIN, y, pageWidth - (MARGIN * 2), 10, 'F');
  doc.setTextColor(COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("ORDEN DE COMPRA", pageWidth / 2, y + 7, { align: "center" });
  
  y += 15;

  // 4. METADATA (OC #, Fecha, Cotización)
  doc.setTextColor(COLORS.text);
  doc.setFontSize(10);
  
  // Fecha (Izquierda)
  doc.setFont("helvetica", "bold");
  doc.text("FECHA:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(format(data.date, "dd 'de' MMMM, yyyy", { locale: es }), MARGIN + 20, y);

  // Tabla info derecha (OC # y Cotización)
  const metaStartX = pageWidth - MARGIN - 70;
  
  doc.setDrawColor(COLORS.lightGray);
  doc.setLineWidth(0.1);
  
  // OC Number Box
  doc.setFont("helvetica", "bold");
  doc.text("N° O.C.", metaStartX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(COLORS.primary); // Destacar el número
  doc.text(data.ocNumber, pageWidth - MARGIN, y, { align: 'right' });
  doc.setTextColor(COLORS.text); // Reset color
  doc.setFontSize(10);

  if (data.cotizacion) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Ref. Cotización:", metaStartX, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.cotizacion, pageWidth - MARGIN, y, { align: 'right' });
  }

  y += 10;

  // 5. BLOQUES DE PROVEEDOR Y PROYECTO
  const boxPadding = 4;
  const col1X = MARGIN + boxPadding;
  const colValueX = MARGIN + 35;
  
  // -- Bloque Proveedor --
  doc.setDrawColor(COLORS.secondary);
  doc.rect(MARGIN, y, pageWidth - (MARGIN * 2), 40); // Caja grande
  
  let boxY = y + 5;
  const addInfoRow = (label: string, value: string) => {
     doc.setFont("helvetica", "bold");
     doc.text(label, col1X, boxY);
     doc.setFont("helvetica", "normal");
     doc.text(`: ${value}`, colValueX, boxY);
     boxY += 5;
  };

  doc.setFontSize(9);
  addInfoRow("RAZÓN SOCIAL", data.supplierName);
  addInfoRow("RUT", data.supplierRut);
  addInfoRow("ATENCIÓN", data.createdByName);
  addInfoRow("DIRECCIÓN", data.supplierAddress);
  addInfoRow("GIRO", "Obras menores de Construcción");
  addInfoRow("CONTACTO", `${data.supplierContact} | ${data.supplierEmail}`);

  y += 42; // Espacio después de la caja proveedor

  // -- Bloque Proyecto --
  doc.setDrawColor(COLORS.secondary);
  doc.setFillColor(COLORS.lightGray);
  // Pequeño header visual para "Proyecto"
  doc.rect(MARGIN, y, pageWidth - (MARGIN * 2), 14); 
  
  boxY = y + 5;
  doc.setFont("helvetica", "bold");
  doc.text("PROYECTO:", col1X, boxY);
  doc.setFont("helvetica", "normal");
  doc.text(data.project, colValueX, boxY);
  
  boxY += 5;
  doc.setFont("helvetica", "bold");
  doc.text("FILE / OBRA:", col1X, boxY);
  doc.setFont("helvetica", "normal");
  doc.text(data.file, colValueX, boxY);

  y += 18;

  // 6. TABLA DE ÍTEMS
  autoTable(doc, {
    startY: y,
    head: [["Ítem", "Código", "Descripción", "Unidad", "Cant.", "P. Unitario", "Total Neto"]],
    body: data.items.map((item) => [
      item.item,
      item.code,
      item.description,
      item.unit,
      item.quantity,
      formatCurrency(item.unitPrice),
      formatCurrency(item.netValue),
    ]),
    theme: "striped",
    headStyles: { 
      fillColor: COLORS.primary, 
      textColor: COLORS.white, 
      fontStyle: "bold",
      halign: 'center'
    },
    styles: { 
      fontSize: 8, 
      cellPadding: 2,
      lineColor: [200, 200, 200],
      lineWidth: 0.1,
      textColor: COLORS.text
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 }, // Item
      1: { cellWidth: 20 }, // Codigo
      3: { halign: "center", cellWidth: 15 }, // Unidad
      4: { halign: "center", cellWidth: 15 }, // Cant
      5: { halign: "right", cellWidth: 25 },  // Precio
      6: { halign: "right", cellWidth: 25 },  // Total
    },
    didDrawPage: function (dataHook) {
        const pageCount = (doc.internal as any).getNumberOfPages();
        const currentPage = dataHook.pageNumber;
        
        doc.setDrawColor(COLORS.lightGray);
        doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);

        doc.setFontSize(8);
        doc.setTextColor(COLORS.secondary);
        
        doc.text(`Generado: ${new Date().toLocaleString('es-CL')}`, MARGIN, pageHeight - 8);

        const developedText = 'desarrollado por ';
        const linkText = 'teolabs.app';
        const fullText = developedText + linkText;
        const textWidth = doc.getTextWidth(fullText);
        const textX = (pageWidth - textWidth) / 2;
        
        doc.text(developedText, textX, pageHeight - 8);
        doc.setTextColor(COLORS.primary);
        doc.textWithLink(linkText, textX + doc.getTextWidth(developedText), pageHeight - 8, { url: 'https://teolabs.app' });
        doc.setTextColor(COLORS.secondary);

        doc.text(`Página ${currentPage} de ${pageCount}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
    }
  });

  let finalY = (doc as any).lastAutoTable.finalY + 5;

  // 7. TOTALES
  if (finalY > pageHeight - 60) {
      doc.addPage();
      finalY = MARGIN + 10;
  }

  const iva = data.totalNet * 0.19;
  const total = data.totalNet + iva;
  const totalLabelX = pageWidth - MARGIN - 60;
  const totalValueX = pageWidth - MARGIN;

  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);

  const drawSumRow = (label: string, value: number, isTotal = false) => {
      doc.setFont("helvetica", isTotal ? "bold" : "normal");
      doc.text(label, totalLabelX, finalY);
      doc.text(formatCurrency(value), totalValueX, finalY, { align: "right" });
      finalY += 6;
  };

  drawSumRow("SUBTOTAL NETO:", data.totalNet);
  drawSumRow("I.V.A. (19%):", iva);
  
  doc.setDrawColor(COLORS.text);
  doc.line(totalLabelX, finalY, totalValueX, finalY);
  finalY += 2;
  
  doc.setFontSize(11);
  drawSumRow("TOTAL A PAGAR:", total, true);

  finalY += 10;
  
  if (finalY > pageHeight - 75) {
      doc.addPage();
      finalY = MARGIN + 10;
  }

  // 8. CONDICIONES Y DATOS DE FACTURACIÓN
  doc.setDrawColor(COLORS.lightGray);
  doc.setFillColor(250, 250, 250);
  doc.rect(MARGIN, finalY, pageWidth - (MARGIN * 2), 30, 'FD');
  
  let infoY = finalY + 5;
  doc.setFontSize(9);
  doc.setTextColor(COLORS.primary);
  doc.setFont("helvetica", "bold");
  doc.text("DATOS DE FACTURACIÓN:", MARGIN + 5, infoY);
  
  doc.setTextColor(COLORS.text);
  doc.setFont("helvetica", "normal");
  infoY += 5;
  
  const colLeft = MARGIN + 5;
  const colRight = MARGIN + 100;
  
  doc.text("RAZÓN SOCIAL: PAGNOL ASSET MANAGEMENT", colLeft, infoY);
  doc.text("Fono: 975 698 724", colRight, infoY);
  infoY += 5;
  doc.text("RUT: 77.123.456-K", colLeft, infoY);
  doc.text("Email: admin@pagnol.cl", colRight, infoY);
  infoY += 5;
  doc.text("DIRECCIÓN: Av. del Titanio 34, La Serena", colLeft, infoY);
  infoY += 5;
  doc.text("GIRO: Minería y Gestión de Activos", colLeft, infoY);
  
  finalY += 35;

  doc.setFont("helvetica", "bold");
  doc.text(`CONDICIONES DE PAGO: ${data.paymentTerms || "30 días"}`, MARGIN, finalY);
  finalY += 15;

  // 9. FIRMAS
  const sigBoxY = finalY;
  const sigBoxHeight = 25;
  
  if (sigBoxY > pageHeight - 40) {
      doc.addPage();
      finalY = MARGIN + 20;
  }

  doc.setDrawColor(COLORS.text);
  doc.rect(MARGIN, finalY, pageWidth - (MARGIN * 2), sigBoxHeight);
  
  const centerX = MARGIN + ((pageWidth - (MARGIN * 2)) / 2);
  doc.line(centerX, finalY, centerX, finalY + sigBoxHeight);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.text("Carolina Morales Aguilera", MARGIN + 5, finalY + 14);
  doc.setFont("helvetica", "bold");
  doc.text("Jefe de Administración y Finanzas", MARGIN + 5, finalY + 18);
  doc.text("PAGNOL ASSET MANAGEMENT", MARGIN + 5, finalY + 22);

  doc.setFont("helvetica", "normal");
  doc.text("ACEPTACIÓN PROVEEDOR:", centerX + 5, finalY + 5);
  doc.setFont("helvetica", "bold");
  doc.text(data.supplierName, centerX + 5, finalY + 22);

  finalY += sigBoxHeight + 5;
  
  doc.setFontSize(7);
  doc.setTextColor("#888");
  doc.text("Av. del Titanio 34, La Serena. Fono: (51) 234 5678. Email: contacto@pagnol.cl", pageWidth / 2, finalY, { align: 'center' });

  // --- GENERACIÓN DEL ARCHIVO ---
  const safeName = data.supplierName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  const filename = `OC_${data.ocNumber}_${safeName}.pdf`;
  
  return { 
    blob: doc.output("blob"), 
    filename 
  };
}
