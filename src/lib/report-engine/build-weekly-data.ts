import 'server-only';
import type { WorkOrder, WorkReport, WorkReportSignature, WorkWeeklyReport } from '@/modules/core/lib/data';
import { consolidateWeekly } from '@/modules/core/lib/work-order-consolidation';
import { WORK_REPORT_STATUS_LABEL } from '@/modules/core/lib/work-report-labels';

// Traduce un WorkWeeklyReport + sus diarios consolidados al contrato de datos
// del motor PDF semanal (weekly-template.hbs). El resumen (HH/OT/dotación por
// día y totales) se deriva con consolidateWeekly, que a su vez considera si cada
// diario consolida OT (modo cascada) o captura manual (legacy).

function fmtFecha(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value as any);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function lastSignature(signatures: WorkReportSignature[], step: WorkReportSignature['step']) {
  return [...signatures].reverse().find((s) => s.step === step);
}

async function fetchAsDataUri(url?: string | null): Promise<string> {
  try {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

export async function construirDatosSemanal(
  weekly: WorkWeeklyReport,
  reports: WorkReport[],
  orders: WorkOrder[],
  tenantName?: string | null,
): Promise<any> {
  const cons = consolidateWeekly(reports, orders);

  const signatures = weekly.signatures || [];
  const sup = lastSignature(signatures, 'supervisor');
  const ops = lastSignature(signatures, 'operations');
  const [firmaSup, firmaOps] = await Promise.all([
    fetchAsDataUri(sup?.signature),
    fetchAsDataUri(ops?.signature),
  ]);

  return {
    meta: {
      tenant: tenantName || '',
      title: weekly.title || '',
      client: weekly.client || '',
      faena: weekly.faena || '',
      obra: weekly.obra || '',
      contract: weekly.contractNumber || '',
      area: weekly.area || '',
      specialty: weekly.specialty || '',
      supervisor: weekly.supervisorName || '',
      desde: fmtFecha(weekly.startDate),
      hasta: fmtFecha(weekly.endDate),
    },
    resumen: {
      reportCount: cons.reportCount,
      otTotal: cons.otTotal,
      hhTotal: cons.hhTotal,
      workersMax: cons.workersMax,
    },
    dias: cons.dias.map((d) => ({
      fecha: fmtFecha(d.fecha),
      otNumber: d.otNumber || '—',
      otCount: d.otCount,
      workers: d.workers,
      hh: d.hh,
      estado: (WORK_REPORT_STATUS_LABEL as Record<string, string>)[d.estado] || d.estado,
    })),
    observaciones: weekly.observations || '',
    entregaTurno: weekly.shiftHandover || '',
    firmas: {
      supervisor: { nombre: sup?.userName || weekly.supervisorName || '', cargo: sup?.userRole || 'Supervisor responsable', firma: firmaSup },
      operaciones: { nombre: ops?.userName || '', cargo: ops?.userRole || 'Jefe de operaciones', firma: firmaOps },
    },
  };
}
