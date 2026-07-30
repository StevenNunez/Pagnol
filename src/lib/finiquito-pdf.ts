import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { montoEnPalabrasCLP } from './numero-a-palabras';
import type { Severance, Tenant } from '@/modules/core/lib/data';
import { TERMINATION_CAUSE_LABELS, type TerminationCause } from '@/modules/data/mutations/severanceMath';

// PDF de finiquito (Remuneraciones F5 / ADR-012).
//
// ⚠️ Se dibuja desde el SNAPSHOT del finiquito, nunca recalculando: el documento
// debe decir lo que se emitió aunque después cambien la UF, los festivos o el
// contrato (mismo criterio que el PDF de liquidación, ADR-009 §4).
//
// A diferencia del PDF anterior, este cita la causal legal invocada y detalla el
// feriado proporcional en días hábiles y corridos — que es donde estaba el error
// de cálculo y donde el trabajador tiene que poder verificar el número.

const CLP = (n: number) =>
    new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const FECHA = (iso: string) => {
    if (!iso) return '—';
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
};

const FECHA_LARGA = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return new Date(Number(y), Number(m) - 1, Number(d))
        .toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
};

export interface FiniquitoPdfInput {
    severance: Severance;
    tenant: Pick<Tenant, 'name'> & { rut?: string | null; address?: string | null };
    workerRut?: string | null;
    cargo?: string | null;
}

export function generarFiniquitoPdf({ severance: s, tenant, workerRut, cargo }: FiniquitoPdfInput): jsPDF {
    const doc = new jsPDF();
    const W = doc.internal.pageSize.getWidth();
    const causa = TERMINATION_CAUSE_LABELS[s.cause as TerminationCause] || s.cause;

    // ── Encabezado
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('FINIQUITO DE CONTRATO DE TRABAJO', W / 2, 20, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    autoTable(doc, {
        startY: 28,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 1.5 },
        columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 32 },
            2: { fontStyle: 'bold', cellWidth: 32 },
        },
        body: [
            ['Empleador:', tenant.name || '—', 'Trabajador:', s.userName],
            ['RUT:', tenant.rut || '—', 'RUT:', workerRut || '—'],
            ['Dirección:', tenant.address || '—', 'Cargo:', cargo || '—'],
            ['Fecha ingreso:', FECHA(s.startDate), 'Fecha término:', FECHA(s.endDate)],
        ],
    });

    let y = (doc as any).lastAutoTable.finalY + 6;

    // ── Causal invocada: es el dato que define qué se paga y qué no
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('CAUSAL DE TÉRMINO', 15, y);
    doc.setFont('helvetica', 'normal');
    const causaLines = doc.splitTextToSize(causa, W - 30);
    doc.text(causaLines, 15, y + 5);
    y += 5 + causaLines.length * 4 + 4;

    // ── Detalle
    const filas: Array<[string, string, string]> = [];

    if (s.indemnityYears > 0) {
        filas.push([
            'Indemnización por años de servicio',
            `${s.indemnifiableYears} año(s) × ${CLP(s.cappedBase)}`,
            CLP(s.indemnityYears),
        ]);
    }
    if (s.indemnityNotice > 0) {
        filas.push([
            'Indemnización sustitutiva del aviso previo',
            '1 mes',
            CLP(s.indemnityNotice),
        ]);
    }
    if (s.vacationPay > 0) {
        filas.push([
            'Feriado proporcional',
            // Ambos números: el devengado en hábiles y el pagado en corridos.
            `${s.vacationDaysHabiles.toFixed(2)} días hábiles = ${s.vacationDaysCorridos.toFixed(2)} días corridos`,
            CLP(s.vacationPay),
        ]);
    }
    if (s.lastPayrollNet > 0) {
        filas.push([
            'Liquidación del último mes',
            FECHA(s.endDate).slice(3),
            CLP(s.lastPayrollNet),
        ]);
    }

    filas.push(['TOTAL HABERES', '', CLP(s.totalEarnings)]);

    for (const d of s.deductions || []) {
        filas.push([`(−) ${d.name}`, '', `-${CLP(d.amount)}`]);
    }

    autoTable(doc, {
        startY: y,
        head: [['CONCEPTO', 'DETALLE', 'MONTO']],
        body: filas,
        theme: 'grid',
        styles: { fontSize: 9, cellPadding: 2 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
        columnStyles: {
            1: { cellWidth: 62, textColor: [100, 100, 100] },
            2: { halign: 'right', cellWidth: 32 },
        },
        didParseCell: (data) => {
            const raw = data.row.raw as unknown as string[] | undefined;
            if (String(raw?.[0] ?? '').startsWith('TOTAL')) data.cell.styles.fontStyle = 'bold';
        },
    });

    y = (doc as any).lastAutoTable.finalY;

    // ── Total
    autoTable(doc, {
        startY: y + 2,
        theme: 'grid',
        styles: { fontSize: 11, cellPadding: 3, fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right', cellWidth: 45 } },
        body: [['TOTAL FINIQUITO A PAGAR', CLP(s.totalSeverance)]],
        bodyStyles: { fillColor: [241, 245, 249] },
    });

    y = (doc as any).lastAutoTable.finalY + 8;

    // ── Declaración
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const declaracion =
        `En ${FECHA_LARGA(s.paymentDate || s.closedAt?.slice(0, 10) || s.endDate)}, `
        + `don(ña) ${s.userName}, RUT ${workerRut || '—'}, declara recibir de ${tenant.name}, `
        + `RUT ${tenant.rut || '—'}, la suma de ${montoEnPalabrasCLP(s.totalSeverance)} `
        + `(${CLP(s.totalSeverance)}), por concepto de las prestaciones que se detallan, `
        + 'derivadas del término de su contrato de trabajo por la causal individualizada. '
        + 'El trabajador declara haber recibido conforme el total señalado y no tener reclamo '
        + 'alguno que formular en contra del empleador por concepto de remuneraciones, '
        + 'cotizaciones previsionales, feriados ni por ningún otro concepto derivado de la '
        + 'relación laboral que ha finalizado.';
    doc.text(doc.splitTextToSize(declaracion, W - 30), 15, y, { align: 'justify', maxWidth: W - 30 });

    y += Math.ceil(declaracion.length / 95) * 4 + 18;

    // ── Firmas
    doc.line(25, y, 90, y);
    doc.line(W - 90, y, W - 25, y);
    doc.setFontSize(8);
    doc.text('Firma Trabajador', 57, y + 5, { align: 'center' });
    doc.text('Firma Empleador', W - 57, y + 5, { align: 'center' });
    doc.text(s.userName, 57, y + 10, { align: 'center' });
    doc.text(tenant.name || '', W - 57, y + 10, { align: 'center' });

    // ── Ratificación ante ministro de fe (art. 177)
    y += 20;
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    doc.text(
        doc.splitTextToSize(
            'Este finiquito debe ser firmado por el interesado y ratificado ante un ministro de fe '
            + '(inspector del trabajo, notario público, oficial del Registro Civil o secretario municipal) '
            + 'para poder ser invocado por el empleador (art. 177 del Código del Trabajo).',
            W - 30,
        ),
        15, y,
    );
    doc.setTextColor(0);

    return doc;
}

export function descargarFiniquitoPdf(input: FiniquitoPdfInput) {
    const doc = generarFiniquitoPdf(input);
    const nombre = input.severance.userName.replace(/\s+/g, '_');
    doc.save(`Finiquito_${nombre}_${input.severance.endDate.slice(0, 10)}.pdf`);
}
