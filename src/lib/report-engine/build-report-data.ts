import 'server-only';
import type { WorkReport, WorkReportSignature } from '@/modules/core/lib/data';

// Traduce un WorkReport (modelo actual de la app) al contrato de datos del motor
// PDF (ver sample-data.json). Los campos que el modelo todavía NO captura (matriz
// HH por OT, actividades estructuradas, housekeeping, cabecera SQM completa, etc.)
// se rellenan vacíos o con defaults; las fases de modelo de datos los irán
// completando. Las fotos se embeben como data URI para no depender de la red de
// Chromium en serverless.

function fmtFecha(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value as any);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

async function fetchAsDataUri(url?: string | null): Promise<string> {
  try {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}

function lastSignature(signatures: WorkReportSignature[], step: WorkReportSignature['step']) {
  return [...signatures].reverse().find((s) => s.step === step);
}

// Checklist estándar de housekeeping (página 4). Hasta que se modele en datos,
// se entrega la estructura sin marcar para que la página conserve su formato.
const HOUSEKEEPING_ITEMS = [
  '2.1 Área de trabajo limpia y ordenada (talleres, HDPE, FRP, soldadura, torre)',
  '2.2 Salas de cambio limpias',
  '2.3 Bodegas ordenadas',
  '2.4 Sector de acopio limpio',
  '2.5 Perímetro de instalaciones limpio',
  '2.6 Residuos retirados',
  '2.7 Materiales correctamente almacenados',
  '2.8 Herramientas guardadas',
  '2.9 No existen riesgos visibles',
  '2.10 Evidencia fotográfica enviada a WhatsApp',
];
const HOUSEKEEPING_JEFE_ITEMS = [
  '5.1 Revisión de fotos',
  '5.2 Revisión checklist',
  '5.3 Área en condiciones',
  '5.4 Desviaciones detectadas',
];

export async function construirDatosReporte(report: WorkReport, tenantName?: string | null): Promise<any> {
  const otNumber = report.otNumber || '';

  // OTs del día → columnas de la matriz. Mapa id→número para traducir las horas.
  const dailyOts = report.dailyOts || [];
  const otIdToNumber = new Map(dailyOts.map((o) => [o.id, o.otNumber || '']));
  const otColumns = dailyOts.map((o) => o.otNumber || '').filter(Boolean);

  const fotos = await Promise.all(
    (report.photos || []).map(async (p) => ({
      ot: '', // las fotos aún no se asocian a OT (fase de modelo de datos)
      titulo: p.description || '',
      ejecutor: p.userName || '',
      visado: '',
      img: await fetchAsDataUri(p.url),
    })),
  );

  const signatures = report.signatures || [];
  const sup = lastSignature(signatures, 'supervisor');
  const ops = lastSignature(signatures, 'operations');
  const fin = lastSignature(signatures, 'final');

  return {
    meta: {
      faena: report.faena || '',
      obra: report.obra || '',
      fecha: fmtFecha(report.workDate),
      ctto: report.contractNumber || '',
      addendum: report.addendumNumber || 'N/A',
      supervisor: report.supervisorName || '',
      turno: report.shift || '',
      area: report.area || '',
      especialidad: report.specialty || '',
      emitidoPor: report.emittedBy || report.supervisorName || '',
      cargoEmisor: report.emittedByRole || '',
    },
    jornada: {
      tipo: report.workSchedule || '',
      modalidad: report.dayNight || '',
      inicio: report.startTime || '',
      almuerzo: report.lunchStart || '',
      reinicio: report.restartTime || '',
      final: report.endTime || '',
    },
    ots: otColumns.length ? otColumns : otNumber ? [otNumber] : [],
    personal: (report.labor || []).map((l, i) => {
      // Traduce las horas internas (clave = otId) al número de OT que usa el motor.
      const horas: Record<string, number> = {};
      for (const [otId, val] of Object.entries(l.hours || {})) {
        const num = otIdToNumber.get(otId);
        if (num) horas[num] = Number(val) || 0;
      }
      const sumHoras = Object.values(horas).reduce((a, b) => a + (Number(b) || 0), 0);
      const colacion = Number(l.colacion) || 0;
      const doc = Number(l.documentacion) || 0;
      const traslado = Number(l.traslados) || 0;
      const hext = Number(l.overtimeHours) || 0;
      const subhh = sumHoras + colacion + doc + traslado;
      return {
        n: i + 1,
        nombre: l.name || '',
        cargo: l.role || '',
        ausencia: l.absenceReason || '',
        horas,
        colacion: colacion || '',
        doc: doc || '',
        traslado: traslado || '',
        subhh,
        hext,
        total: subhh + hext,
      };
    }),
    actividades: report.activities
      ? [
          {
            n: 1,
            descripcion: report.activities,
            area: report.area || '',
            unidad: '',
            cantidad: '',
            programado: '',
            ot: otNumber,
            avance: report.progressPercent || 0,
          },
        ]
      : [],
    equipos: (report.equipment || []).map((e, i) => ({
      cod: i + 1,
      equipo: e.equipment || '',
      horas: Number(e.hours) || 0,
      actividad: e.activity || '',
    })),
    improductividad: [],
    materiales: (report.materials || []).map((m, i) => ({
      cod: i + 1,
      descripcion: m.material || '',
      cantidad: Number(m.quantity) || 0,
      unidad: m.unit || '',
      observaciones: '',
    })),
    observaciones: report.progressObservations || '',
    programacion: [],
    fotos,
    firmas: {
      supervisor: { nombre: sup?.userName || report.supervisorName || '', cargo: sup?.userRole || 'Supervisor' },
      jefe: { nombre: ops?.userName || '', cargo: ops?.userRole || 'Jefe de operaciones' },
      ito: { nombre: fin?.userName || '', cargo: fin?.userRole || 'ITO SQM' },
    },
    housekeeping: {
      subtitulo: '',
      codigo: '',
      rev: '',
      sector: '',
      inspeccion: '',
      items: HOUSEKEEPING_ITEMS.map((texto) => ({ texto, estado: '', responsable: '', observaciones: '' })),
      observaciones: '',
      fotos: ['', '', '', ''],
      jefeItems: HOUSEKEEPING_JEFE_ITEMS.map((texto) => ({ texto, estado: '', observaciones: '' })),
    },
    // logos: undefined → el motor usa los assets por defecto (VALAR/SQM)
  };
}
