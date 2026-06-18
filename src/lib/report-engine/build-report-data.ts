import 'server-only';
import type { WorkOrder, WorkReport, WorkReportSignature } from '@/modules/core/lib/data';
import { createDefaultHousekeeping, HOUSEKEEPING_CODE, HOUSEKEEPING_REV } from '@/modules/core/lib/work-report-housekeeping';
import { consolidateWorkOrders } from '@/modules/core/lib/work-order-consolidation';

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

export async function construirDatosReporte(
  report: WorkReport,
  tenantName?: string | null,
  orders?: WorkOrder[],
): Promise<any> {
  const otNumber = report.otNumber || '';

  // Modo cascada: si el Diario consolida OT (work_orders), personal/matriz HH/
  // actividades/equipos/materiales/fotos se DERIVAN de esas OT (decisión: 100%
  // desde las OT). Si no hay OT consolidadas, se usa la captura manual (legacy).
  const consolidating = !!(orders && orders.length);
  const cons = consolidating ? consolidateWorkOrders(orders!) : null;

  // OTs del día → columnas de la matriz. Mapa id→número para traducir las horas.
  // En modo cascada las columnas son las OT consolidadas (clave horas = OT.id).
  const dailyOts = report.dailyOts || [];
  const otIdToNumber = consolidating
    ? new Map(orders!.map((o) => [o.id, o.otNumber || '']))
    : new Map(dailyOts.map((o) => [o.id, o.otNumber || '']));
  const otColumns = consolidating
    ? cons!.ots.map((c) => c.otNumber).filter(Boolean)
    : dailyOts.map((o) => o.otNumber || '').filter(Boolean);

  const fotos = consolidating
    ? await Promise.all(
        orders!.flatMap((o) =>
          (o.photos || []).map(async (p) => ({
            ot: o.otNumber || '',
            titulo: p.description || '',
            ejecutor: p.executor || p.userName || '',
            visado: p.approver || '',
            img: await fetchAsDataUri(p.url),
          })),
        ),
      )
    : await Promise.all(
        (report.photos || []).map(async (p) => ({
          ot: (p.otId && otIdToNumber.get(p.otId)) || '',
          titulo: p.description || '',
          ejecutor: p.executor || p.userName || '',
          visado: p.approver || '',
          img: await fetchAsDataUri(p.url),
        })),
      );

  const signatures = report.signatures || [];
  const sup = lastSignature(signatures, 'supervisor');
  const ops = lastSignature(signatures, 'operations');
  const fin = lastSignature(signatures, 'final');

  const hk = report.housekeeping || createDefaultHousekeeping();
  const hkFotos = await Promise.all((hk.photos || []).map((u) => fetchAsDataUri(u)));

  // Imagen del trazo de cada firma (SignaturePad la guarda como data URI PNG).
  const [firmaSup, firmaJefe, firmaIto] = await Promise.all([
    fetchAsDataUri(sup?.signature),
    fetchAsDataUri(ops?.signature),
    fetchAsDataUri(fin?.signature),
  ]);

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
    personal: consolidating
      ? cons!.personal.map((p, i) => {
          // horas vienen indexadas por OT.id → traducir a número de OT.
          const horas: Record<string, number> = {};
          for (const [otId, val] of Object.entries(p.horas || {})) {
            const num = otIdToNumber.get(otId);
            if (num) horas[num] = Number(val) || 0;
          }
          return {
            n: i + 1,
            nombre: p.nombre,
            cargo: p.cargo,
            ausencia: '',
            horas,
            colacion: '',
            doc: '',
            traslado: '',
            subhh: p.total,
            hext: 0,
            total: p.total,
          };
        })
      : (report.labor || []).map((l, i) => {
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
    actividades: consolidating
      ? cons!.porOt.map((r, i) => ({
          n: i + 1,
          descripcion: r.actividad,
          area: r.area,
          unidad: '',
          cantidad: '',
          programado: '',
          ot: r.otNumber,
          avance: Number(r.avance) || 0,
        }))
      : (report.structuredActivities && report.structuredActivities.length)
      ? report.structuredActivities.map((a, i) => ({
          n: i + 1,
          descripcion: a.description || '',
          area: a.area || '',
          unidad: a.unit || '',
          cantidad: a.quantity ?? '',
          programado: a.plannedQuantity ?? '',
          ot: (a.otId && otIdToNumber.get(a.otId)) || otNumber,
          avance: Number(a.progress) || 0,
        }))
      : report.activities
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
    equipos: consolidating
      ? cons!.equipos.map((e, i) => ({
          cod: i + 1,
          equipo: e.equipo,
          horas: Number(e.horas) || 0,
          actividad: '',
        }))
      : (report.equipment || []).map((e, i) => ({
          cod: i + 1,
          equipo: e.equipment || '',
          horas: Number(e.hours) || 0,
          actividad: e.activity || '',
        })),
    improductividad: (report.interferences || []).map((it) => {
      const horas = Number(it.hours) || 0;
      const ntrab = Number(it.workerCount) || 0;
      return {
        ot: (it.otId && otIdToNumber.get(it.otId)) || '',
        motivo: it.reason || '',
        responsable: it.responsible || '',
        horas: horas || '',
        ntrab: ntrab || '',
        totalhh: horas * ntrab || '',
      };
    }),
    materiales: consolidating
      ? cons!.materiales.map((m, i) => ({
          cod: i + 1,
          descripcion: m.material,
          cantidad: Number(m.cantidad) || 0,
          unidad: m.unidad || '',
          observaciones: '',
        }))
      : (report.materials || []).map((m, i) => ({
          cod: i + 1,
          descripcion: m.material || '',
          cantidad: Number(m.quantity) || 0,
          unidad: m.unit || '',
          observaciones: m.observations || '',
        })),
    observaciones: report.progressObservations || '',
    // Distribución de HH por especialidad (solo modo cascada: derivada de las OT).
    porEspecialidad: consolidating
      ? cons!.porEspecialidad.map((s) => ({ especialidad: s.especialidad, hh: s.hh }))
      : [],
    programacion: (report.nextDayPlan || []).map((p) => ({
      descripcion: p.description || '',
      area: p.area || '',
      equipos: p.equipment || '',
      herramienta: p.tools || '',
    })),
    fotos,
    firmas: {
      supervisor: { nombre: sup?.userName || report.supervisorName || '', cargo: sup?.userRole || 'Supervisor', firma: firmaSup },
      jefe: { nombre: ops?.userName || '', cargo: ops?.userRole || 'Jefe de operaciones', firma: firmaJefe },
      ito: { nombre: fin?.userName || '', cargo: fin?.userRole || 'ITO SQM', firma: firmaIto },
    },
    housekeeping: {
      subtitulo: hk.subtitle || '',
      codigo: hk.code || HOUSEKEEPING_CODE,
      rev: hk.rev || HOUSEKEEPING_REV,
      sector: hk.sector || '',
      inspeccion: hk.inspection || '',
      items: (hk.items || []).map((it) => ({
        texto: it.text || '',
        estado: it.status || '',
        responsable: it.responsible || '',
        observaciones: it.observations || '',
      })),
      observaciones: hk.observations || '',
      fotos: [hkFotos[0] || '', hkFotos[1] || '', hkFotos[2] || '', hkFotos[3] || ''],
      jefeItems: (hk.jefeItems || []).map((it) => ({
        texto: it.text || '',
        estado: it.status || '',
        observaciones: it.observations || '',
      })),
    },
    // logos: undefined → el motor usa los assets por defecto (VALAR/SQM)
  };
}
