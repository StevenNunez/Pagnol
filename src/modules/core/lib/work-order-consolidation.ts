import type { WorkOrder, WorkReport, WorkReportLaborItem } from './data';

// Consolida un conjunto de OT (work_orders) para alimentar el Reporte Diario:
// matriz HH (persona × OT), resumen por OT, equipos/materiales unificados,
// HH totales y distribución por especialidad. Reutilizable en UI y en el PDF.

export interface ConsolidatedColumn { id: string; otNumber: string }
export interface ConsolidatedPerson { nombre: string; cargo: string; horas: Record<string, number>; total: number }
export interface ConsolidatedOtRow { id: string; otNumber: string; actividad: string; area: string; hh: number; estado: string; avance: number }
export interface ConsolidatedEquipment { equipo: string; horas: number }
export interface ConsolidatedMaterial { material: string; cantidad: number; unidad: string }
export interface SpecialtyHH { especialidad: string; hh: number }

export interface Consolidation {
  ots: ConsolidatedColumn[];          // columnas de la matriz (por OT)
  personal: ConsolidatedPerson[];      // filas: personas únicas, horas por OT (clave = OT.id)
  porOt: ConsolidatedOtRow[];          // resumen por OT (código/actividad/área/HH/estado/%)
  equipos: ConsolidatedEquipment[];
  materiales: ConsolidatedMaterial[];
  hhTotal: number;
  porEspecialidad: SpecialtyHH[];
}

const round = (n: number) => Math.round(n * 100) / 100;
const sumHoras = (o: WorkOrder) => (o.labor || []).reduce((a, l) => a + (Number(l.hours) || 0), 0);

export function consolidateWorkOrders(orders: WorkOrder[]): Consolidation {
  const ots: ConsolidatedColumn[] = orders.map((o) => ({ id: o.id, otNumber: o.otNumber || '(s/n)' }));

  // Personal agrupado por persona (nombre normalizado); horas indexadas por OT.id.
  const personMap = new Map<string, ConsolidatedPerson>();
  for (const o of orders) {
    for (const l of o.labor || []) {
      // Prioriza userId (seleccionado del catálogo) sobre el nombre en texto
      // libre: evita que "J. Pérez" y "Juan Perez" se cuenten como personas
      // distintas en la matriz consolidada.
      const key = l.userId || (l.name || '').trim().toLowerCase() || l.id;
      let p = personMap.get(key);
      if (!p) {
        p = { nombre: l.name || '', cargo: l.role || '', horas: {}, total: 0 };
        personMap.set(key, p);
      }
      if (!p.cargo && l.role) p.cargo = l.role;
      const h = Number(l.hours) || 0;
      p.horas[o.id] = round((p.horas[o.id] || 0) + h);
      p.total = round(p.total + h);
    }
  }
  const personal = [...personMap.values()];

  const porOt: ConsolidatedOtRow[] = orders.map((o) => ({
    id: o.id,
    otNumber: o.otNumber || '',
    actividad: o.description || '',
    area: o.area || '',
    hh: round(sumHoras(o)),
    estado: o.status,
    avance: Number(o.executedPercent) || 0,
  }));

  // Equipos consolidados por assetId (si viene del catálogo) o por nombre.
  const equipMap = new Map<string, { equipo: string; horas: number }>();
  for (const o of orders) {
    for (const e of o.equipment || []) {
      const name = (e.equipment || '').trim();
      if (!name) continue;
      const key = e.assetId || name;
      const entry = equipMap.get(key);
      if (entry) entry.horas = round(entry.horas + (Number(e.hours) || 0));
      else equipMap.set(key, { equipo: name, horas: round(Number(e.hours) || 0) });
    }
  }
  const equipos = [...equipMap.values()];

  // Materiales consolidados por nombre + unidad.
  const matMap = new Map<string, ConsolidatedMaterial>();
  for (const o of orders) {
    for (const m of o.materials || []) {
      const name = (m.material || '').trim();
      if (!name) continue;
      const key = `${name.toLowerCase()}|${(m.unit || '').toLowerCase()}`;
      let entry = matMap.get(key);
      if (!entry) { entry = { material: name, cantidad: 0, unidad: m.unit || '' }; matMap.set(key, entry); }
      entry.cantidad = round(entry.cantidad + (Number(m.quantity) || 0));
    }
  }
  const materiales = [...matMap.values()];

  const hhTotal = round(porOt.reduce((a, r) => a + r.hh, 0));

  // Distribución por especialidad.
  const specMap = new Map<string, number>();
  for (const o of orders) {
    const spec = (o.specialty || '').trim() || 'Sin especialidad';
    specMap.set(spec, round((specMap.get(spec) || 0) + sumHoras(o)));
  }
  const porEspecialidad = [...specMap.entries()].map(([especialidad, hh]) => ({ especialidad, hh }));

  return { ots, personal, porOt, equipos, materiales, hhTotal, porEspecialidad };
}

// ── Consolidación semanal ────────────────────────────────────────────────────
// El Reporte Semanal agrupa varios Reportes Diarios. Cada diario aporta sus HH:
// si el diario consolida OT, sus HH salen de esas OT; si es manual (legacy),
// salen de su `labor`. Devuelve resumen por día + totales de la semana.

const laborHoursManual = (l: WorkReportLaborItem) =>
  Object.values(l.hours || {}).reduce((a, b) => a + (Number(b) || 0), 0) +
  (Number(l.colacion) || 0) + (Number(l.documentacion) || 0) +
  (Number(l.traslados) || 0) + (Number(l.overtimeHours) || 0);

export interface WeeklyDayRow {
  reportId: string;
  fecha: string;
  otNumber: string;
  estado: string;
  otCount: number;
  workers: number;
  hh: number;
}

export interface WeeklyConsolidation {
  dias: WeeklyDayRow[];
  hhTotal: number;
  otTotal: number;       // suma de OT a lo largo de la semana
  reportCount: number;
  workersMax: number;    // mayor dotación en un día
}

// effectiveTotals: HH/HM/dotación/OT de un diario, considerando si consolida OT.
// Si el diario ya salió de borrador/observado y tiene una copia congelada
// (consolidatedOrdersSnapshot, ver transitionWorkReport), se usa esa copia en
// vez de las OT en vivo — mismo criterio que la UI y los PDF.
export function dailyEffectiveTotals(report: WorkReport, allOrders: WorkOrder[]) {
  const orderIds = report.consolidatedOrderIds || [];
  if (orderIds.length) {
    const useSnapshot = report.status !== 'draft' && report.status !== 'observed' && !!report.consolidatedOrdersSnapshot?.length;
    const orders = useSnapshot
      ? (report.consolidatedOrdersSnapshot as WorkOrder[])
      : allOrders.filter((o) => orderIds.includes(o.id));
    const cons = consolidateWorkOrders(orders);
    const hm = round(cons.equipos.reduce((a, e) => a + (Number(e.horas) || 0), 0));
    return { hh: cons.hhTotal, hm, workers: cons.personal.length, otCount: cons.ots.length };
  }
  const labor = report.labor || [];
  const equipment = report.equipment || [];
  return {
    hh: round(labor.reduce((a, l) => a + laborHoursManual(l), 0)),
    hm: round(equipment.reduce((a, e) => a + (Number(e.hours) || 0), 0)),
    workers: labor.length,
    otCount: (report.dailyOts || []).length,
  };
}

export function consolidateWeekly(reports: WorkReport[], allOrders: WorkOrder[]): WeeklyConsolidation {
  const ordered = [...reports].sort((a, b) => String(a.workDate).localeCompare(String(b.workDate)));
  const dias: WeeklyDayRow[] = ordered.map((r) => {
    const t = dailyEffectiveTotals(r, allOrders);
    return {
      reportId: r.id,
      fecha: typeof r.workDate === 'string' ? r.workDate : new Date(r.workDate).toISOString().slice(0, 10),
      otNumber: r.otNumber || '',
      estado: r.status,
      otCount: t.otCount,
      workers: t.workers,
      hh: t.hh,
    };
  });
  return {
    dias,
    hhTotal: round(dias.reduce((a, d) => a + d.hh, 0)),
    otTotal: dias.reduce((a, d) => a + d.otCount, 0),
    reportCount: dias.length,
    workersMax: dias.reduce((a, d) => Math.max(a, d.workers), 0),
  };
}
