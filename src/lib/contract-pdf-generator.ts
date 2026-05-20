
import jsPDF from 'jspdf';
import 'jspdf-autotable';

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
    } catch (error) {
        console.error("Error fetching image:", error);
        return null;
    }
}

interface ContractData {
    transactionId: string;
    employeeName: string;
    employeeRut?: string;
    employeeSignatureUrl?: string | null;
    site: string;
    items: { name: string; id: string; internalCode?: string; condition?: string }[];
    deliveryTimestamp: Date;
    pagnoleroName: string;
    pagnoleroSignatureUrl?: string | null;
}

export async function generateContractPDF(data: ContractData) {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    // -- HEADER --
    const logoUrl = '/logo.png';
    const logoBase64 = await getBase64FromUrl(logoUrl);
    if (logoBase64) {
        doc.addImage(logoBase64, 'PNG', margin, y, 25, 25);
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("CONTRATO DE RESPONSABILIDAD", pageWidth / 2, y + 15, { align: "center" });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Uso y Custodia de Activos", pageWidth / 2, y + 22, { align: "center" });

    y += 40;

    // -- DETAILS --
    doc.setFontSize(10);
    doc.text(`ID Transacción: ${data.transactionId}`, margin, y);
    doc.text(`Fecha: ${data.deliveryTimestamp.toLocaleString('es-CL')}`, pageWidth - margin, y, { align: "right" });
    y += 10;

    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    // -- EMPLOYEE INFO --
    doc.setFont("helvetica", "bold");
    doc.text("RESPONSABLE (TRABAJADOR)", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.text(`Nombre: ${data.employeeName}`, margin, y);
    doc.text(`RUT: ${data.employeeRut || 'N/A'}`, pageWidth / 2, y);
    y += 7;
    doc.text(`Faena/Sitio: ${data.site}`, margin, y);
    y += 15;

    // -- ASSETS TABLE --
    doc.setFont("helvetica", "bold");
    doc.text("ACTIVOS ENTREGADOS", margin, y);
    y += 5;

    const tableBody = data.items.map((item, i) => [
        i + 1,
        item.name,
        item.internalCode || item.id.substring(0, 8),
        item.condition || 'N/A'
    ]);

    (doc as any).autoTable({
        startY: y,
        head: [['#', 'Nombre del Activo', 'ID Corto', 'Estado']],
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185], textColor: 255 },
        styles: { fontSize: 9 },
        margin: { left: margin, right: margin }
    });

    y = (doc as any).lastAutoTable.finalY + 15;

    // -- CLAUSES --
    doc.setFont("helvetica", "bold");
    doc.text("TÉRMINOS Y CONDICIONES", margin, y);
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const terms = [
        "1. El trabajador declara recibir los activos detallados en perfectas condiciones operativas (salvo lo indicado).",
        "2. El trabajador asume la responsabilidad total por el cuidado, custodia y uso correcto de los activos.",
        "3. En caso de pérdida, daño por mal uso o negligencia, la empresa se reserva el derecho de aplicar las sanciones correspondientes.",
        "4. Este documento ha sido firmado biométricamente, validando la identidad del receptor de manera irrefutable."
    ];

    terms.forEach(term => {
        const splitText = doc.splitTextToSize(term, pageWidth - (margin * 2));
        doc.text(splitText, margin, y);
        y += (splitText.length * 4) + 2;
    });

    // -- SIGNATURES --
    // Check if we can add the employee's signature image
    let signatureBase64 = null;
    if (data.employeeSignatureUrl) {
        signatureBase64 = await getBase64FromUrl(data.employeeSignatureUrl);
    }

    let pagnoleroSignatureBase64 = null;
    if (data.pagnoleroSignatureUrl) {
        pagnoleroSignatureBase64 = await getBase64FromUrl(data.pagnoleroSignatureUrl);
    }

    y += 20;

    if (signatureBase64) {
        // Center image horizontally over the signature line
        const imgWidth = 40;
        const imgHeight = 20;
        doc.addImage(signatureBase64, 'PNG', margin + 50 - (imgWidth / 2), y - 18, imgWidth, imgHeight);
    }

    if (pagnoleroSignatureBase64) {
        // Center image horizontally over the pagnolero signature line
        const imgWidth = 40;
        const imgHeight = 20;
        doc.addImage(pagnoleroSignatureBase64, 'PNG', pageWidth - margin - 50 - (imgWidth / 2), y - 18, imgWidth, imgHeight);
    }

    doc.setLineWidth(0.2);
    doc.line(margin + 20, y, margin + 80, y); // Worker line
    doc.line(pageWidth - margin - 80, y, pageWidth - margin - 20, y); // Pagnolero line

    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text("FIRMA TRABAJADOR", margin + 50, y, { align: "center" });
    doc.text("ENTREGADO POR", pageWidth - margin - 50, y, { align: "center" });

    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("(Biometría Validada)", margin + 50, y, { align: "center" });
    doc.text(data.pagnoleroName, pageWidth - margin - 50, y, { align: "center" });

    const pdfBlob = doc.output('blob');
    const filename = `Contrato_${data.transactionId}_${sanitizeFileName(data.employeeName)}.pdf`;

    return { blob: pdfBlob, filename };
}

function sanitizeFileName(name: string) {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
}
