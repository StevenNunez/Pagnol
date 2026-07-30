import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montoEnPalabrasCLP } from './numero-a-palabras';
import type { PayrollLine, PayrollRun, Tenant, EmploymentContract } from '@/modules/core/lib/data';

// PDF de liquidación de sueldo (Remuneraciones F3).
//
// Replica la estructura del documento que el trabajador reconoce —secciones
// HABERES AFECTOS / OTROS HABERES / ASIGNACIONES VARIAS / DESCUENTOS LEGALES,
// totales, monto en palabras y "Recibí Conforme"— porque una liquidación con otro
// layout obliga a re-aprender a leerla.
//
// ⚠️ Se dibuja desde el SNAPSHOT de la línea, nunca recalculando: el documento
// tiene que decir lo que se emitió, aunque las tasas hayan cambiado después
// (ADR-009 §4).

const CLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const MES = (iso: string) => {
    const [y, m] = iso.split('-');
    return new Date(Number(y), Number(m) - 1, 1)
        .toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
};

/** Fila de la tabla: concepto, valor de referencia, haber, descuento. */
type Fila = [string, string, string, string];

const seccion = (titulo: string): Fila => [titulo, '', '', ''];
const haber = (label: string, monto: number, ref = ''): Fila => [label, ref, CLP(monto), ''];
const descuento = (label: string, monto: number, ref = ''): Fila => [label, ref, '', CLP(monto)];

export interface LiquidacionPdfInput {
    line: PayrollLine;
    run: PayrollRun;
    tenant: Pick<Tenant, 'name'> & { rut?: string | null };
    /** Del snapshot de la línea: lo pactado cuando se emitió. */
    contract?: EmploymentContract | null;
    workerRut?: string | null;
    cargo?: string | null;
}

/**
 * Construye el documento. Devuelve el jsPDF para que el llamador decida entre
 * `save()`, `output('blob')` o adjuntarlo a un correo.
 */
export function buildLiquidacionPdf({
    line, run, tenant, contract, workerRut, cargo,
}: LiquidacionPdfInput): jsPDF {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    // El snapshot es la fuente: si la línea guardó su entrada, se usa esa.
    const snap: any = line.inputSnapshot || {};
    const con: EmploymentContract | null = contract ?? snap.contract ?? null;

    // ── Encabezado de la empresa
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(tenant.name || '—', 14, 18);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (tenant.rut) doc.text(`RUT ${tenant.rut}`, 14, 24);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('LIQUIDACIÓN DE REMUNERACIONES', W / 2, 34, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Remuneración del mes: ${MES(run.periodMonth)}`, W / 2, 40, { align: 'center' });

    // ── Identificación (dos columnas, como el documento real)
    autoTable(doc, {
        startY: 46,
        theme: 'plain',
        styles: { fontSize: 8.5, cellPadding: 1.2 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 32 }, 2: { fontStyle: 'bold', cellWidth: 32 } },
        body: [
            ['Nombre', line.userName, 'Salud', con?.healthSystem === 'isapre' ? 'ISAPRE' : 'FONASA'],
            ['RUT', workerRut || '—', 'AFP', con?.afpName || '—'],
            ['Días trabajados', String(line.workedDays), 'Sueldo base', CLP(con?.baseSalary ?? 0)],
            ['Horas extras', String(line.overtimeHours || 0), 'Fecha de pago', run.paymentDate || '—'],
            ['Cargo', cargo || '—', 'Modalidad', con?.salaryMode === 'daily' ? 'Por día' : 'Mensual'],
        ],
    });

    // ── Detalle
    const filas: Fila[] = [];

    filas.push(seccion('HABERES AFECTOS'));
    filas.push(haber('Sueldo base', line.baseSalaryEarned));
    if (line.gratification) filas.push(haber('Gratificación legal', line.gratification));
    if (line.overtimeAmount)
        filas.push(haber('Horas extras', line.overtimeAmount, `${line.overtimeHours} h`));
    for (const e of (snap.taxableEarnings || []) as { name: string; amount: number; prorate?: boolean }[]) {
        // El snapshot guarda el monto MENSUAL de los prorrateados; el efectivo
        // sale del resultado, así que se recompone igual que en el motor.
        const efectivo = e.prorate
            ? Math.round((Number(e.amount) / 30) * Math.min(line.workedDays, 30))
            : Number(e.amount);
        if (efectivo) filas.push(haber(e.name, efectivo));
    }

    const noImponibles = (snap.nonTaxableEarnings || []) as { name: string; amount: number; prorate?: boolean }[];
    if (noImponibles.length) {
        filas.push(seccion('OTROS HABERES'));
        for (const e of noImponibles) {
            const efectivo = e.prorate
                ? Math.round((Number(e.amount) / 30) * Math.min(line.workedDays, 30))
                : Number(e.amount);
            if (efectivo) filas.push(haber(e.name, efectivo));
        }
    }

    if (line.familyAllowance) {
        filas.push(seccion('ASIGNACIONES VARIAS'));
        filas.push(haber('Asignación familiar', line.familyAllowance,
            `${con?.familyCharges ?? 0} carga(s)`));
    }

    filas.push(seccion('DESCUENTOS LEGALES'));
    if (line.pensionAmount)
        filas.push(descuento(`AFP ${con?.afpName || ''}`.trim(), line.pensionAmount,
            `10% sobre ${CLP(line.totalTaxable)}`));
    if (line.pensionCommission)
        filas.push(descuento('Comisión AFP', line.pensionCommission));
    filas.push(descuento(con?.healthSystem === 'isapre' ? 'Isapre (plan)' : 'Fonasa',
        line.healthAmount + line.healthAdditional,
        con?.healthSystem === 'isapre' && line.healthAdditional
            ? `7% legal + adicional` : '7%'));
    if (line.unemploymentAmount)
        filas.push(descuento('Seguro de cesantía', line.unemploymentAmount));
    if (line.incomeTax)
        filas.push(descuento('Impuesto único', line.incomeTax,
            `sobre ${CLP(line.totalTaxable - (line.totalDeductions - line.incomeTax - line.advancesAmount))}`));
    if (line.advancesAmount)
        filas.push(descuento('Anticipo', line.advancesAmount));
    for (const d of (snap.otherDeductions || []) as { name: string; amount: number }[]) {
        if (Number(d.amount)) filas.push(descuento(d.name, Number(d.amount)));
    }

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 3,
        head: [['Detalle de haberes y descuentos', 'Referencia', 'Haberes', 'Descuentos']],
        body: filas,
        theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: [60, 60, 60], fontSize: 8.5 },
        columnStyles: {
            0: { cellWidth: 78 },
            1: { cellWidth: 38, fontSize: 7.5, textColor: [110, 110, 110] },
            2: { halign: 'right' },
            3: { halign: 'right' },
        },
        // Las filas de sección van sin monto: se marcan en negrita y con fondo
        didParseCell: (data) => {
            const row = data.row.raw as Fila;
            if (row && row[1] === '' && row[2] === '' && row[3] === '' && data.section === 'body') {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fillColor = [238, 238, 238];
                data.cell.styles.fontSize = 8;
            }
        },
    });

    // ── Totales
    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: {
            0: { cellWidth: 116, fontStyle: 'bold' },
            1: { halign: 'right', fontStyle: 'bold' },
            2: { halign: 'right', fontStyle: 'bold' },
        },
        body: [
            ['TOTALES', CLP(line.totalEarnings), CLP(line.totalDeductions)],
        ],
    });

    autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY,
        theme: 'grid',
        styles: { fontSize: 11, cellPadding: 2.5 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { halign: 'right', fontStyle: 'bold' } },
        body: [['LÍQUIDO A PAGAR', CLP(line.netPay)]],
    });

    let y = (doc as any).lastAutoTable.finalY + 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Son: ${montoEnPalabrasCLP(line.netPay)}`, 14, y);

    // Aviso honesto: si el cálculo dejó avisos, el documento no los esconde.
    if (line.warnings?.length) {
        y += 6;
        doc.setFontSize(7);
        doc.setTextColor(150, 60, 0);
        doc.text(`Observaciones: ${line.warnings.join(' · ')}`, 14, y, { maxWidth: W - 28 });
        doc.setTextColor(0, 0, 0);
    }

    // ── Firma
    y += 26;
    doc.setFontSize(8);
    doc.text('_________________________________', W / 2, y, { align: 'center' });
    doc.text('Recibí Conforme', W / 2, y + 5, { align: 'center' });
    doc.text(line.userName, W / 2, y + 10, { align: 'center' });
    doc.setFontSize(6.5);
    doc.setTextColor(120, 120, 120);
    doc.text(
        'Certifico que he recibido conforme el pago de mi remuneración y que el presente documento '
        + 'refleja fielmente las operaciones del período.',
        14, y + 18, { maxWidth: W - 28 },
    );

    return doc;
}

/** Nombre de archivo estable y ordenable. */
export function liquidacionFileName(line: PayrollLine, run: PayrollRun): string {
    const slug = line.userName.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `Liquidacion_${run.periodMonth.slice(0, 7)}_${slug}.pdf`;
}
