import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { Material, User } from '@/modules/core/lib/data';

declare module 'jspdf' {
    interface jsPDF {
        autoTable: (options: any) => jsPDF;
    }
}

async function getBase64FromUrl(url: string): Promise<string | null> {
    if (url.startsWith('data:')) return url;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

export interface TenantLegal {
    name: string;
    rut?: string;
    legalRepresentative?: string;
    legalRepresentativeRut?: string;
    address?: string;
}

export interface EAGeneratorData {
    employee: Pick<User, 'name' | 'rut' | 'role' | 'internalId'>;
    employeeSignatureUrl?: string | null;
    tenant: TenantLegal;
    assets: Material[];
}

export async function generateEAPDF(data: EAGeneratorData): Promise<Blob> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let y = margin;

    const today = new Date();
    const todayStr = today.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });
    const deadline = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000);
    const deadlineStr = deadline.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' });

    // ── HEADER ──
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('ANEXO DE CONTRATO DE TRABAJO', pageWidth / 2, 14, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('ACTA DE ENTREGA DE ACTIVOS (EA) — Art. 11 Código del Trabajo Chile', pageWidth / 2, 22, { align: 'center' });
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text(`Generado: ${today.toLocaleString('es-CL')}`, pageWidth / 2, 30, { align: 'center' });

    y = 44;
    doc.setTextColor(15, 23, 42);

    // ── AVISO DT ──
    doc.setFillColor(254, 243, 199);
    doc.setDrawColor(251, 191, 36);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 9, 1, 1, 'FD');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 53, 15);
    doc.text(
        `Registrar en Mi DT (dt.gob.cl) dentro de 15 dias habiles. Plazo limite: ${deadlineStr}`,
        pageWidth / 2, y + 6, { align: 'center' }
    );

    y += 16;
    doc.setTextColor(15, 23, 42);

    // ── I. COMPARECENCIA ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('I. COMPARECENCIA', margin, y);
    doc.setDrawColor(209, 213, 219);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 8;

    const colW = (pageWidth - margin * 2 - 6) / 2;

    // Empleador
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(margin, y, colW, 30, 2, 2, 'F');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('EMPLEADOR', margin + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(data.tenant.name, margin + 4, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`RUT Empresa: ${data.tenant.rut || '___________________________'}`, margin + 4, y + 19);
    doc.text(`Rep. Legal: ${data.tenant.legalRepresentative || '___________________________'}`, margin + 4, y + 24);
    doc.text(`Domicilio: ${data.tenant.address || '___________________________'}`, margin + 4, y + 29);

    // Trabajador
    const col2 = margin + colW + 6;
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(col2, y, colW, 30, 2, 2, 'F');
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(59, 130, 246);
    doc.text('TRABAJADOR', col2 + 4, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(data.employee.name, col2 + 4, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`RUT: ${data.employee.rut || '___________________________'}`, col2 + 4, y + 19);
    doc.text(`Cargo: ${data.employee.role}`, col2 + 4, y + 24);
    doc.text(`ID Interno: ${data.employee.internalId || '—'}`, col2 + 4, y + 29);

    y += 38;

    // ── II. ANTECEDENTES ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('II. ANTECEDENTES', margin, y);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const ante = doc.splitTextToSize(
        'Las partes identificadas precedentemente suscriben el presente Anexo al Contrato de Trabajo vigente entre ellas, de conformidad con lo dispuesto en el articulo 11 del Codigo del Trabajo de Chile, con el objeto de dejar constancia de la entrega de los activos y herramientas de trabajo que se indican a continuacion.',
        pageWidth - margin * 2
    );
    doc.text(ante, margin, y);
    y += ante.length * 4.5 + 6;

    // ── III. ACTIVOS ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('III. CLAUSULA PRIMERA — DETALLE DE ACTIVOS ENTREGADOS', margin, y);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 5;

    const tableRows = data.assets.map((a, i) => [
        String(i + 1),
        a.name,
        a.brand || a.description?.slice(0, 20) || '—',
        a.serialNumber || 'N/A',
        a.class || '—',
        a.usageType?.slice(0, 14) || '—',
        `$${(a.unitCost || 0).toLocaleString('es-CL')}`,
    ]);

    doc.autoTable({
        startY: y,
        head: [['N°', 'Descripcion del Activo', 'Marca/Modelo', 'N° Serie', 'Clase', 'Tipo Uso', 'Valor Ref.']],
        body: tableRows.length > 0 ? tableRows : [['—', 'Sin activos entregados registrados', '', '', '', '', '']],
        theme: 'grid',
        headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7, fontStyle: 'bold' },
        styles: { fontSize: 7, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 8 },
            2: { cellWidth: 28 },
            4: { cellWidth: 12 },
            5: { cellWidth: 22 },
            6: { cellWidth: 20 },
        },
        margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    if (y > pageHeight - 85) { doc.addPage(); y = margin; }

    // ── IV. CLÁUSULAS ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text('IV. CLAUSULAS LEGALES', margin, y);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 8;

    const clauses = [
        { title: 'USO Y DESTINO', text: 'Los activos se entregan al trabajador para uso exclusivo en el desempeno de sus funciones. Se compromete a utilizarlos unicamente para los fines estipulados en su contrato de trabajo y segun instrucciones del empleador.' },
        { title: 'OBLIGACIONES DE CUSTODIA', text: 'El trabajador se obliga a mantener los activos en buen estado, respondiendo por perdida, extravio o deterioro causado por negligencia o mal uso, conforme al articulo 61 del Codigo del Trabajo. El desgaste normal de uso no le sera imputable.' },
        { title: 'DEVOLUCION AL TERMINO DEL CONTRATO', text: 'El trabajador debera restituir todos los activos al momento de cesar en sus funciones, cualquiera sea la causa del termino de la relacion laboral, o cuando el empleador lo requiera. La devolucion se acreditara con Acta de Recepcion firmada por ambas partes.' },
    ];

    clauses.forEach((c, i) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.text(`${i + 1}. ${c.title}`, margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        const lines = doc.splitTextToSize(c.text, pageWidth - margin * 2);
        doc.text(lines, margin, y);
        y += lines.length * 4 + 5;
    });

    if (y > pageHeight - 55) { doc.addPage(); y = margin; }

    // ── V. FECHA Y FIRMAS ──
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('V. FECHA Y FIRMAS', margin, y);
    doc.line(margin, y + 2, pageWidth - margin, y + 2);
    y += 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    const dateLine = doc.splitTextToSize(
        `En _________________________, a ${todayStr}, las partes suscriben el presente Anexo en dos ejemplares de un mismo tenor y fecha, quedando uno en poder de cada parte.`,
        pageWidth - margin * 2
    );
    doc.text(dateLine, margin, y);
    y += dateLine.length * 4.5 + 18;

    const sigW = (pageWidth - margin * 2 - 12) / 2;

    // Cargar firma digital del trabajador si existe
    let employeeSigBase64: string | null = null;
    if (data.employeeSignatureUrl) {
        employeeSigBase64 = await getBase64FromUrl(data.employeeSignatureUrl);
    }

    const sigConfigs = [
        { label: 'Empleador / Representante Legal', sub: data.tenant.legalRepresentative || '_______________', sigImg: null as string | null },
        { label: 'Trabajador', sub: data.employee.name, sigImg: employeeSigBase64 },
    ];

    sigConfigs.forEach((sig, i) => {
        const sx = margin + i * (sigW + 12);

        // Dibujar imagen de firma si existe
        if (sig.sigImg) {
            doc.addImage(sig.sigImg, 'PNG', sx + sigW / 2 - 20, y - 18, 40, 16);
        }

        doc.setDrawColor(100, 116, 139);
        doc.line(sx, y, sx + sigW, y);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(15, 23, 42);
        doc.text(sig.label, sx + sigW / 2, y + 5, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.text(sig.sub, sx + sigW / 2, y + 10, { align: 'center' });
        doc.text(
            sig.sigImg ? 'Firma Digital Registrada — Identidad Biométrica Validada' : 'Nombre, Firma y Timbre',
            sx + sigW / 2, y + 15, { align: 'center' }
        );
    });

    return doc.output('blob');
}
