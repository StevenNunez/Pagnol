
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

/**
 * Re-muestrea una imagen al tamaño con el que se va a IMPRIMIR.
 *
 * `addImage` incrusta el archivo original completo, sin mirar los milímetros que
 * ocupa en la hoja: una firma capturada a pantalla completa viaja entera para
 * dibujarse en 40 mm. Medido sobre un acta real (`MTL-TX-0011`): **1,28 MB en
 * una sola página**, de los cuales 1,24 MB eran cuatro imágenes (534 + 178 +
 * 397 + 132 KB). Eso se sube desde faena por un canal con timeout de 15 s, así
 * que el peso no es cosmético: es la diferencia entre respaldar el acta y perderla.
 *
 * Se mantiene PNG y NO se pasa a JPEG a propósito: las firmas tienen fondo
 * transparente y el JPEG no lo soporta — quedarían con un rectángulo negro
 * encima del papel.
 *
 * Si algo falla devuelve la imagen original: un acta pesada es mucho mejor que
 * un acta sin la firma.
 */
async function ajustarResolucion(dataUrl: string, anchoMaxPx: number): Promise<string> {
    if (typeof document === 'undefined') return dataUrl;
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = dataUrl;
        });

        if (!img.width || img.width <= anchoMaxPx) return dataUrl;

        const escala = anchoMaxPx / img.width;
        const canvas = document.createElement('canvas');
        canvas.width = anchoMaxPx;
        canvas.height = Math.max(1, Math.round(img.height * escala));
        const ctx = canvas.getContext('2d');
        if (!ctx) return dataUrl;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/png');
    } catch {
        return dataUrl;
    }
}

/**
 * Ancho en píxeles para una imagen que se dibuja con `anchoMm` milímetros.
 *
 * 200 ppp es calidad de impresión de oficina: por encima de eso el papel no
 * distingue nada y sólo se paga en bytes.
 */
const pxParaMm = (anchoMm: number) => Math.round((anchoMm / 25.4) * 200);

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
    logoUrl?: string;
    /**
     * Cómo se acreditó que este trabajador recibió los activos. Va impreso: un
     * contrato de responsabilidad que no dice cómo se verificó la identidad del
     * receptor deja al lector suponiendo que hubo biometría, incluso cuando la
     * entrega salió por excepción autorizada.
     */
    verification?: {
        mode: 'biometric' | 'exception';
        /** Sólo en excepciones: quién la autorizó y por qué. */
        authorizedByName?: string | null;
        reason?: string | null;
    } | null;
}

export async function generateContractPDF(data: ContractData) {
    // `compress` comprime los streams del documento. Es gratis en calidad y el
    // acta viaja a la nube desde faena, donde cada KB se paga en señal.
    const doc = new jsPDF({ compress: true });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    let y = margin;

    // -- HEADER --
    const logoBase64 = await getBase64FromUrl(data.logoUrl || '/logo.png');
    if (logoBase64) {
        doc.addImage(await ajustarResolucion(logoBase64, pxParaMm(25)), 'PNG', margin, y, 25, 25);
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
    // "N/A" se lee como "no aplica" — y en un contrato donde el trabajador
    // "asume la responsabilidad total", el RUT SÍ aplica: es lo único que
    // identifica a la persona más allá de un nombre de pila. Decir que falta
    // deja el vacío a la vista de quien lea el acta, en vez de disimularlo.
    doc.text(`RUT: ${data.employeeRut?.trim() || 'NO REGISTRADO'}`, pageWidth / 2, y);
    y += 7;
    doc.text(`Faena/Sitio: ${data.site?.trim() || 'NO INDICADA'}`, margin, y);
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

    autoTable(doc, {
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

    // La cláusula de identidad tiene que decir lo que REALMENTE pasó. Antes
    // afirmaba siempre "firmado biométricamente … de manera irrefutable", incluso
    // cuando no hubo verificación facial — y "irrefutable" no es sostenible ni
    // con ella: el sistema aún no detecta si es una persona viva o una foto.
    const clausulaIdentidad = data.verification?.mode === 'exception'
        ? `4. La identidad del receptor NO fue verificada biométricamente. La entrega se realizó bajo excepción autorizada por ${data.verification.authorizedByName || 'un responsable autorizado'}${data.verification.reason ? `, por el siguiente motivo: ${data.verification.reason}` : ''}.`
        : "4. La identidad del receptor fue verificada mediante reconocimiento facial al momento de la entrega, y el registro de esa verificación queda almacenado junto a este documento.";

    const terms = [
        "1. El trabajador declara recibir los activos detallados en perfectas condiciones operativas (salvo lo indicado).",
        "2. El trabajador asume la responsabilidad total por el cuidado, custodia y uso correcto de los activos.",
        "3. En caso de pérdida, daño por mal uso o negligencia, la empresa se reserva el derecho de aplicar las sanciones correspondientes.",
        clausulaIdentidad,
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
        const firma = await ajustarResolucion(signatureBase64, pxParaMm(imgWidth));
        doc.addImage(firma, 'PNG', margin + 50 - (imgWidth / 2), y - 18, imgWidth, imgHeight);
    }

    if (pagnoleroSignatureBase64) {
        // Center image horizontally over the pagnolero signature line
        const imgWidth = 40;
        const imgHeight = 20;
        const firma = await ajustarResolucion(pagnoleroSignatureBase64, pxParaMm(imgWidth));
        doc.addImage(firma, 'PNG', pageWidth - margin - 50 - (imgWidth / 2), y - 18, imgWidth, imgHeight);
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
    // Tiene que decir lo mismo que la cláusula 4. Estaba fijo en "(Biometría
    // Validada)" pasara lo que pasara, así que una entrega por excepción
    // producía un acta que se CONTRADICE a sí misma: arriba "la identidad NO fue
    // verificada biométricamente" y aquí abajo la afirmación contraria. Es el
    // mismo defecto que ya se corrigió en la cláusula, sobreviviendo en el pie.
    doc.text(
        data.verification?.mode === 'exception' ? "(Entrega por excepción autorizada)" : "(Biometría Validada)",
        margin + 50, y, { align: "center" },
    );
    doc.text(data.pagnoleroName, pageWidth - margin - 50, y, { align: "center" });

    const pdfBlob = doc.output('blob');
    const filename = `Contrato_${data.transactionId}_${sanitizeFileName(data.employeeName)}.pdf`;

    return { blob: pdfBlob, filename };
}

function sanitizeFileName(name: string) {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
}
