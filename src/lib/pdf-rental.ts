import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { rentalCategoryLabel, type RentalBillingCycle } from "@/modules/core/lib/data";

// Generadores de PDF del módulo Arriendos:
//   1) Solicitud de Cotización (RFQ)  → para pedir precio al arrendador (sin montos).
//   2) Orden de Compra (OC) de arriendo → con desglose neto / IVA / total.
// Ambos toman los datos de la empresa del tenant (no hardcodeados).

declare module "jspdf" {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const COLORS = {
  primary: "#1f2937",   // gris oscuro pizarra (neutro, imprime bien)
  accent: "#ea580c",    // naranja Pagnol para el título
  text: "#334155",
  light: "#e2e8f0",
  white: "#ffffff",
  muted: "#64748b",
};
const MARGIN = 15;

const CYCLE_LABELS: Record<RentalBillingCycle, string> = {
  daily: "Diario", weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", one_time: "Pago único",
};

const fmtMoney = (v: number, currency = "CLP") =>
  currency === "CLP"
    ? `$${Math.round(v || 0).toLocaleString("es-CL")}`
    : `${currency} ${(v || 0).toLocaleString("es-CL", { maximumFractionDigits: 2 })}`;

const fmtDate = (d?: Date | string | null) =>
  d ? format(new Date(d as any), "dd 'de' MMMM, yyyy", { locale: es }) : "—";
const fmtShort = (d?: Date | string | null) =>
  d ? format(new Date(d as any), "dd-MM-yyyy") : "—";

async function getBase64FromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export interface RentalCompanyInfo {
  name: string;
  rut?: string;
  address?: string;
  logoUrl?: string;
}

export interface RentalPdfLessor {
  name: string;
  rut?: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
}

export interface RentalPdfItem {
  name: string;
  category: string;
  quantity: number;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  billingCycle: RentalBillingCycle;
  unitPrice?: number; // solo en OC
}

// ── Encabezado común ──────────────────────────────────────────────────────────
async function drawHeader(doc: jsPDF, company: RentalCompanyInfo, title: string): Promise<number> {
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(COLORS.primary);
  doc.text((company.name || "PAGNOL").toUpperCase(), MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(COLORS.text);
  if (company.rut) { doc.text(`RUT: ${company.rut}`, MARGIN, y + 5); }
  if (company.address) { doc.text(company.address, MARGIN, y + 9); }

  if (company.logoUrl) {
    const logo = await getBase64FromUrl(company.logoUrl);
    if (logo) {
      try { doc.addImage(logo, "PNG", pageWidth - MARGIN - 40, y - 5, 40, 15); } catch { /* ignore */ }
    }
  }

  y += 20;
  doc.setFillColor(COLORS.accent);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 10, "F");
  doc.setTextColor(COLORS.white);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, pageWidth / 2, y + 7, { align: "center" });

  return y + 15;
}

function drawFooter(doc: jsPDF) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageCount = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(COLORS.light);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.setFontSize(8);
    doc.setTextColor(COLORS.muted);
    doc.text(`Generado: ${new Date().toLocaleString("es-CL")}`, MARGIN, pageHeight - 8);
    const dev = "desarrollado por ";
    const link = "teolabs.app";
    const tw = doc.getTextWidth(dev + link);
    const tx = (pageWidth - tw) / 2;
    doc.text(dev, tx, pageHeight - 8);
    doc.setTextColor(COLORS.accent);
    doc.textWithLink(link, tx + doc.getTextWidth(dev), pageHeight - 8, { url: "https://teolabs.app" });
    doc.setTextColor(COLORS.muted);
    doc.text(`Página ${i} de ${pageCount}`, pageWidth - MARGIN, pageHeight - 8, { align: "right" });
  }
}

function drawLessorBox(doc: jsPDF, y: number, lessor: RentalPdfLessor | undefined, attn: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const col1X = MARGIN + 4;
  const colValueX = MARGIN + 38;
  doc.setDrawColor(COLORS.muted);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 34);
  let boxY = y + 6;
  doc.setFontSize(9);
  const row = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLORS.text);
    doc.text(label, col1X, boxY);
    doc.setFont("helvetica", "normal");
    doc.text(`: ${value || "—"}`, colValueX, boxY);
    boxY += 5.5;
  };
  row("ARRENDADOR", lessor?.name || "Por definir");
  row("RUT", lessor?.rut || "—");
  row("CONTACTO", lessor?.contactName || "—");
  row("EMAIL / FONO", [lessor?.email, lessor?.phone].filter(Boolean).join(" | ") || "—");
  row("ATENCIÓN", attn || "—");
  return y + 38;
}

// ── 1) Solicitud de Cotización (RFQ) ──────────────────────────────────────────
export async function generateRentalQuoteRequestPDF(data: {
  company: RentalCompanyInfo;
  code: string;
  date?: Date;
  deadline?: Date | string | null;
  lessor?: RentalPdfLessor;
  requestedBy?: string;
  items: RentalPdfItem[];
  notes?: string;
}): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = await drawHeader(doc, data.company, "SOLICITUD DE COTIZACIÓN — ARRIENDO");

  // Metadata
  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);
  doc.setFont("helvetica", "bold");
  doc.text("FECHA:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(fmtDate(data.date || new Date()), MARGIN + 20, y);

  doc.setFont("helvetica", "bold");
  doc.text("N° SOLICITUD", pageWidth - MARGIN - 60, y);
  doc.setTextColor(COLORS.accent);
  doc.text(data.code, pageWidth - MARGIN, y, { align: "right" });
  doc.setTextColor(COLORS.text);
  if (data.deadline) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Responder antes de:", pageWidth - MARGIN - 60, y);
    doc.setFont("helvetica", "normal");
    doc.text(fmtShort(data.deadline), pageWidth - MARGIN, y, { align: "right" });
  }
  y += 10;

  y = drawLessorBox(doc, y, data.lessor, data.requestedBy || "");
  y += 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(COLORS.muted);
  doc.text(
    "Estimado proveedor: agradeceremos cotizar el arriendo de los siguientes equipos. Indique precio por período, disponibilidad y condiciones (traslado, operador, combustible).",
    MARGIN, y, { maxWidth: pageWidth - MARGIN * 2 },
  );
  y += 12;

  autoTable(doc, {
    startY: y,
    head: [["Ítem", "Equipo", "Categoría", "Cant.", "Período", "Ciclo", "Precio cotizado"]],
    body: data.items.map((it, i) => [
      i + 1,
      it.name,
      rentalCategoryLabel(it.category),
      it.quantity,
      `${fmtShort(it.startDate)} → ${fmtShort(it.endDate)}`,
      CYCLE_LABELS[it.billingCycle],
      "", // a llenar por el arrendador
    ]),
    theme: "striped",
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: "bold", halign: "center" },
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: COLORS.text },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      3: { halign: "center", cellWidth: 14 },
      5: { halign: "center", cellWidth: 22 },
      6: { cellWidth: 32 },
    },
  });

  let finalY = (doc as any).lastAutoTable.finalY + 10;
  if (data.notes?.trim()) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(COLORS.text);
    doc.text("OBSERVACIONES:", MARGIN, finalY);
    doc.setFont("helvetica", "normal");
    finalY += 5;
    doc.text(data.notes.trim(), MARGIN, finalY, { maxWidth: pageWidth - MARGIN * 2 });
  }

  drawFooter(doc);
  const safe = (data.lessor?.name || "arrendador").replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  return { blob: doc.output("blob"), filename: `Cotizacion_${data.code}_${safe}.pdf` };
}

// ── 2) Orden de Compra (OC) de arriendo ───────────────────────────────────────
export async function generateRentalOcPDF(data: {
  company: RentalCompanyInfo;
  ocNumber: string;
  date?: Date;
  lessor?: RentalPdfLessor;
  project?: string;
  createdByName?: string;
  items: RentalPdfItem[];
  currency?: string;
  taxRate?: number;       // % IVA (19 por defecto, 0 = exento)
  billingCycle: RentalBillingCycle;
  paymentTerms?: string;
  refQuote?: string;
}): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const currency = data.currency || "CLP";
  const taxRate = data.taxRate ?? 19;
  let y = await drawHeader(doc, data.company, "ORDEN DE COMPRA — ARRIENDO");

  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);
  doc.setFont("helvetica", "bold");
  doc.text("FECHA:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(fmtDate(data.date || new Date()), MARGIN + 20, y);

  doc.setFont("helvetica", "bold");
  doc.text("N° O.C.", pageWidth - MARGIN - 60, y);
  doc.setTextColor(COLORS.accent);
  doc.setFontSize(12);
  doc.text(data.ocNumber, pageWidth - MARGIN, y, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);
  if (data.refQuote) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("Ref. Cotización:", pageWidth - MARGIN - 60, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.refQuote, pageWidth - MARGIN, y, { align: "right" });
  }
  y += 10;

  y = drawLessorBox(doc, y, data.lessor, data.createdByName || "");
  y += 2;

  // Proyecto / Ciclo
  doc.setFillColor(COLORS.light);
  doc.rect(MARGIN, y, pageWidth - MARGIN * 2, 12, "F");
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLORS.text);
  doc.text("PROYECTO / OBRA:", MARGIN + 4, y + 5);
  doc.setFont("helvetica", "normal");
  doc.text(data.project || "—", MARGIN + 42, y + 5);
  doc.setFont("helvetica", "bold");
  doc.text("CICLO:", MARGIN + 4, y + 9.5);
  doc.setFont("helvetica", "normal");
  doc.text(CYCLE_LABELS[data.billingCycle], MARGIN + 42, y + 9.5);
  y += 16;

  const totalNet = data.items.reduce((s, it) => s + (it.unitPrice || 0) * (it.quantity || 1), 0);

  autoTable(doc, {
    startY: y,
    head: [["Ítem", "Equipo", "Categoría", "Cant.", `P. Unit. / ${CYCLE_LABELS[data.billingCycle]}`, "Neto"]],
    body: data.items.map((it, i) => [
      i + 1,
      it.name,
      rentalCategoryLabel(it.category),
      it.quantity,
      fmtMoney(it.unitPrice || 0, currency),
      fmtMoney((it.unitPrice || 0) * (it.quantity || 1), currency),
    ]),
    theme: "striped",
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: "bold", halign: "center" },
    styles: { fontSize: 8, cellPadding: 2.5, lineColor: [200, 200, 200], lineWidth: 0.1, textColor: COLORS.text },
    columnStyles: {
      0: { halign: "center", cellWidth: 12 },
      3: { halign: "center", cellWidth: 14 },
      4: { halign: "right", cellWidth: 38 },
      5: { halign: "right", cellWidth: 30 },
    },
  });

  let finalY = (doc as any).lastAutoTable.finalY + 6;
  if (finalY > pageHeight - 70) { doc.addPage(); finalY = MARGIN + 10; }

  const iva = taxRate > 0 ? totalNet * (taxRate / 100) : 0;
  const total = totalNet + iva;
  const labelX = pageWidth - MARGIN - 60;
  const valueX = pageWidth - MARGIN;
  doc.setFontSize(10);
  doc.setTextColor(COLORS.text);
  const sumRow = (label: string, value: number, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, labelX, finalY);
    doc.text(fmtMoney(value, currency), valueX, finalY, { align: "right" });
    finalY += 6;
  };
  sumRow("SUBTOTAL NETO:", totalNet);
  if (taxRate > 0) sumRow(`I.V.A. (${taxRate}%):`, iva);
  else { doc.setFont("helvetica", "normal"); doc.text("EXENTO DE IVA", labelX, finalY); finalY += 6; }
  doc.setDrawColor(COLORS.text);
  doc.line(labelX, finalY, valueX, finalY);
  finalY += 2;
  doc.setFontSize(11);
  sumRow("TOTAL A PAGAR:", total, true);
  finalY += 8;

  if (finalY > pageHeight - 45) { doc.addPage(); finalY = MARGIN + 10; }
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLORS.text);
  doc.text(`CONDICIONES DE PAGO: ${data.paymentTerms || "30 días"}`, MARGIN, finalY);
  finalY += 12;

  // Firmas
  const sigH = 24;
  if (finalY > pageHeight - sigH - 15) { doc.addPage(); finalY = MARGIN + 10; }
  doc.setDrawColor(COLORS.text);
  doc.rect(MARGIN, finalY, pageWidth - MARGIN * 2, sigH);
  const centerX = MARGIN + (pageWidth - MARGIN * 2) / 2;
  doc.line(centerX, finalY, centerX, finalY + sigH);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text((data.company.name || "Empresa").toUpperCase(), MARGIN + 5, finalY + 19);
  doc.setFont("helvetica", "normal");
  doc.text("ACEPTACIÓN ARRENDADOR:", centerX + 5, finalY + 6);
  doc.setFont("helvetica", "bold");
  doc.text(data.lessor?.name || "—", centerX + 5, finalY + 19);

  drawFooter(doc);
  const safe = (data.lessor?.name || "arrendador").replace(/[^a-zA-Z0-9]/g, "_").substring(0, 20);
  return { blob: doc.output("blob"), filename: `OC_${data.ocNumber}_${safe}.pdf` };
}
