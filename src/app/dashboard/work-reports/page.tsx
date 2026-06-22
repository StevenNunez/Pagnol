'use client';

// ─────────────────────────────────────────────────────────────────────────────
// PANEL EJECUTIVO · Reportes de Trabajo
// Vista única adaptable por rol. Gerencia (work_reports:view_all) ve los widgets
// agregados/financieros; Supervisión Operacional ve lo accionable (tablas + alertas).
// Todo se computa client-side desde useAppState(); sin APIs nuevas.
//
// FUENTE DE VERDAD para HH / materiales / equipos / cumplimiento = OT (work_orders),
// que es la capa granular de la cascada. Los Reportes Diarios alimentan el embudo de
// estados, observaciones y aprobaciones. Así se evita doble conteo (un Diario
// consolida sus OT).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, isToday, startOfDay, startOfMonth, subDays, differenceInDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, LabelList,
} from 'recharts';
import {
  FileText, ClipboardList, Users, Wrench, AlertTriangle, CheckCircle2, Clock,
  Boxes, CalendarRange, Gauge, Hammer, Package, TrendingUp,
} from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppState } from '@/modules/core/contexts/app-provider';
import type { WorkOrder, WorkReport, ToolLog } from '@/modules/core/lib/data';
import { WORK_REPORT_STATUS_LABEL as STATUS_LABEL } from '@/modules/core/lib/work-report-labels';

type Period = 'today' | 'week' | 'month' | 'year' | 'all';
const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoy', week: 'Últimos 7 días', month: 'Este mes', year: 'Este año', all: 'Histórico',
};

const PALETTE = [
  'hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--success))',
  'hsl(var(--warning))', 'hsl(var(--destructive))', 'hsl(var(--muted-foreground))',
];
const CLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 });

const TOOLTIP_STYLE = {
  borderRadius: '16px', border: 'none',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))', fontSize: 11,
} as const;

function inPeriod(d: Date | string | undefined | null, period: Period): boolean {
  if (period === 'all') return true;
  if (!d) return false;
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return false;
  const now = new Date();
  switch (period) {
    case 'today': return isToday(date);
    case 'week': return date >= subDays(startOfDay(now), 6);
    case 'month': return date >= startOfMonth(now);
    case 'year': return date.getFullYear() === now.getFullYear();
  }
}

// HH (horas hombre) declaradas en una OT.
const otHH = (ot: WorkOrder) => (ot.labor || []).reduce((a, l) => a + (Number(l.hours) || 0), 0);
// HM (horas máquina) declaradas en una OT.
const otHM = (ot: WorkOrder) => (ot.equipment || []).reduce((a, e) => a + (Number(e.hours) || 0), 0);
const otIncompleta = (ot: WorkOrder) => ot.status === 'draft' || Number(ot.executedPercent || 0) < 100;

const fmtDate = (d?: Date | string | null) => {
  if (!d) return '—';
  const date = new Date(d as any);
  return isNaN(date.getTime()) ? '—' : format(date, 'dd MMM yyyy', { locale: es });
};

export default function WorkReportsExecutiveDashboard() {
  const router = useRouter();
  const {
    workOrders, workReports, workWeeklyReports, toolLogs, materials,
    workReportAreas, workReportSpecialties, can, isLoading,
  } = useAppState();

  const isManagement = can('work_reports:view_all');

  const [period, setPeriod] = useState<Period>('month');
  const [area, setArea] = useState<string>('all');
  const [specialty, setSpecialty] = useState<string>('all');
  const [supervisor, setSupervisor] = useState<string>('all');

  const orders = workOrders || [];
  const reports = workReports || [];
  const weeklies = workWeeklyReports || [];
  const logs = toolLogs || [];

  // Índice nombre→costo unitario, para estimar consumo en CLP (las OT guardan
  // material como texto libre; se cruza por nombre con el catálogo de bodega).
  const unitCostByName = useMemo(() => {
    const map = new Map<string, number>();
    (materials || []).forEach((m) => {
      if (m?.name) map.set(m.name.trim().toLowerCase(), Number(m.unitCost) || 0);
    });
    return map;
  }, [materials]);
  // Costo exacto por id de catálogo (cuando la OT enlaza materialId); si no, por nombre.
  const unitCostById = useMemo(() => {
    const map = new Map<string, number>();
    (materials || []).forEach((m) => map.set(m.id, Number(m.unitCost) || 0));
    return map;
  }, [materials]);
  const unitCostOf = (name?: string) => (name ? (unitCostByName.get(name.trim().toLowerCase()) || 0) : 0);
  const unitCostOfItem = (m: { materialId?: string; material?: string }) =>
    (m.materialId && unitCostById.has(m.materialId)) ? unitCostById.get(m.materialId)! : unitCostOf(m.material);

  // Opciones de filtros (catálogos + lo presente en los datos).
  const filterOptions = useMemo(() => {
    const areas = new Set<string>();
    (workReportAreas || []).forEach((a) => a.name && areas.add(a.name));
    orders.forEach((o) => o.area && areas.add(o.area));
    const specs = new Set<string>();
    (workReportSpecialties || []).forEach((s) => s.name && specs.add(s.name));
    orders.forEach((o) => o.specialty && specs.add(o.specialty));
    const sups = new Set<string>();
    orders.forEach((o) => o.supervisorName && sups.add(o.supervisorName));
    reports.forEach((r) => r.supervisorName && sups.add(r.supervisorName));
    return {
      areas: [...areas].sort(),
      specialties: [...specs].sort(),
      supervisors: [...sups].sort(),
    };
  }, [workReportAreas, workReportSpecialties, orders, reports]);

  // OT y Diarios filtrados por período + filtros globales.
  const fOrders = useMemo(() => orders.filter((o) =>
    inPeriod(o.workDate, period)
    && (area === 'all' || o.area === area)
    && (specialty === 'all' || o.specialty === specialty)
    && (supervisor === 'all' || o.supervisorName === supervisor)
  ), [orders, period, area, specialty, supervisor]);

  const fReports = useMemo(() => reports.filter((r) =>
    inPeriod(r.workDate, period)
    && (area === 'all' || r.area === area)
    && (specialty === 'all' || r.specialty === specialty)
    && (supervisor === 'all' || r.supervisorName === supervisor)
  ), [reports, period, area, specialty, supervisor]);

  const fWeeklies = useMemo(() => weeklies.filter((w) => inPeriod(w.startDate, period)), [weeklies, period]);

  // ── Agregados / KPIs ──────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const hh = fOrders.reduce((a, o) => a + otHH(o), 0);
    const hm = fOrders.reduce((a, o) => a + otHM(o), 0);
    const incompletas = fOrders.filter(otIncompleta).length;
    const cumpl = fOrders.length
      ? Math.round(fOrders.reduce((a, o) => a + Number(o.executedPercent || 0), 0) / fOrders.length)
      : 0;
    const observados = fReports.filter((r) => r.status === 'observed').length;
    const porAprobar = fReports.filter((r) => r.status === 'pending_review' || r.status === 'operations_approved').length;
    return { hh, hm, incompletas, cumpl, observados, porAprobar };
  }, [fOrders, fReports]);

  // Herramientas pendientes de devolución (no se filtran por período: son préstamos abiertos).
  const toolsOut = useMemo(() => logs.filter((l) => !l.returnDate), [logs]);

  // Stock crítico: usa minStock si está definido; si no, cae a stock <= 0.
  const criticalStock = useMemo(() => (materials || []).filter((m) => {
    if (m.archived) return false;
    const min = m.minStock;
    return typeof min === 'number' ? Number(m.stock) <= min : Number(m.stock) <= 0;
  }), [materials]);

  // ── Datos de gráficos ─────────────────────────────────────────────────────
  const hhByDay = useMemo(() => {
    const byDay = new Map<string, { hh: number; ot: number }>();
    fOrders.forEach((o) => {
      const d = new Date(o.workDate as any);
      if (isNaN(d.getTime())) return;
      const key = format(d, 'yyyy-MM-dd');
      const cur = byDay.get(key) || { hh: 0, ot: 0 };
      cur.hh += otHH(o); cur.ot += 1;
      byDay.set(key, cur);
    });
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ name: format(new Date(k), 'dd MMM', { locale: es }), hh: v.hh, ot: v.ot }));
  }, [fOrders]);

  const statusFunnel = useMemo(() => {
    const order: WorkReport['status'][] = ['draft', 'pending_review', 'observed', 'operations_approved', 'final_approved', 'archived'];
    return order
      .map((s) => ({ name: STATUS_LABEL[s], value: fReports.filter((r) => r.status === s).length }))
      .filter((x) => x.value > 0);
  }, [fReports]);

  const hhBySpecialty = useMemo(() => {
    const map = new Map<string, number>();
    fOrders.forEach((o) => { const k = o.specialty || 'Sin especialidad'; map.set(k, (map.get(k) || 0) + otHH(o)); });
    return [...map.entries()].map(([name, value]) => ({ name, value })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [fOrders]);

  const costByArea = useMemo(() => {
    const map = new Map<string, number>();
    fOrders.forEach((o) => {
      const k = o.area || 'Sin área';
      const cost = (o.materials || []).reduce((a, m) => a + unitCostOfItem(m) * (Number(m.quantity) || 0), 0);
      map.set(k, (map.get(k) || 0) + cost);
    });
    return [...map.entries()].map(([name, value]) => ({ name, value })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [fOrders, unitCostByName, unitCostById]);

  const topMaterials = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; unit: string; cost: number }>();
    fOrders.forEach((o) => (o.materials || []).forEach((m) => {
      if (!m.material) return;
      const key = m.materialId || m.material.trim().toLowerCase();
      const cur = map.get(key) || { name: m.material, qty: 0, unit: m.unit || '', cost: 0 };
      const q = Number(m.quantity) || 0;
      cur.qty += q; cur.cost += unitCostOfItem(m) * q;
      map.set(key, cur);
    }));
    return [...map.values()].sort((a, b) => b.cost - a.cost || b.qty - a.qty).slice(0, 10);
  }, [fOrders, unitCostByName, unitCostById]);

  // ── Tablas accionables ────────────────────────────────────────────────────
  const otIncompletas = useMemo(() => fOrders.filter(otIncompleta).slice(0, 12), [fOrders]);
  const porAprobar = useMemo(() => fReports.filter((r) => r.status === 'pending_review' || r.status === 'operations_approved' || r.status === 'observed'), [fReports]);

  // Total de alertas para la banda superior.
  const totalAlertas = kpis.incompletas + kpis.observados + toolsOut.length + criticalStock.length;

  return (
    <PageShell
      title="Panel Ejecutivo · Reportes"
      description="Indicadores operacionales de OT, Reportes Diarios y Semanales. Filtra por período, área, especialidad y supervisor."
      toolbar={
        <div className="w-full flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <Badge variant="outline" className="rounded-xl w-fit">{PERIOD_LABEL[period]}</Badge>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <FilterSelect value={period} onChange={(v) => setPeriod(v as Period)} placeholder="Período"
              options={[['today', 'Hoy'], ['week', 'Últimos 7 días'], ['month', 'Este mes'], ['year', 'Este año'], ['all', 'Histórico']]} />
            <FilterSelect value={area} onChange={setArea} placeholder="Área"
              options={[['all', 'Todas las áreas'], ...filterOptions.areas.map((a) => [a, a] as [string, string])]} />
            <FilterSelect value={specialty} onChange={setSpecialty} placeholder="Especialidad"
              options={[['all', 'Todas las especialidades'], ...filterOptions.specialties.map((s) => [s, s] as [string, string])]} />
            <FilterSelect value={supervisor} onChange={setSupervisor} placeholder="Supervisor"
              options={[['all', 'Todos los supervisores'], ...filterOptions.supervisors.map((s) => [s, s] as [string, string])]} />
          </div>
        </div>
      }
    >
      {/* Banda de alertas operacionales */}
      {totalAlertas > 0 && (
        <div className="flex flex-wrap gap-2">
          {kpis.incompletas > 0 && <AlertChip tone="warning" icon={<ClipboardList className="h-3.5 w-3.5" />} label={`${kpis.incompletas} OT incompletas`} />}
          {kpis.observados > 0 && <AlertChip tone="warning" icon={<AlertTriangle className="h-3.5 w-3.5" />} label={`${kpis.observados} reportes observados`} />}
          {toolsOut.length > 0 && <AlertChip tone="info" icon={<Hammer className="h-3.5 w-3.5" />} label={`${toolsOut.length} herramientas sin devolver`} />}
          {criticalStock.length > 0 && <AlertChip tone="destructive" icon={<Boxes className="h-3.5 w-3.5" />} label={`${criticalStock.length} materiales en stock crítico`} />}
        </div>
      )}

      {/* FILA 1 · KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
        <Kpi icon={<ClipboardList />} label="OT del período" value={fOrders.length} />
        <Kpi icon={<FileText />} label="Reportes Diarios" value={fReports.length} />
        <Kpi icon={<CalendarRange />} label="Reportes Semanales" value={fWeeklies.length} />
        <Kpi icon={<Users />} label="HH totales" value={kpis.hh.toLocaleString('es-CL')} />
        <Kpi icon={<Wrench />} label="HM totales" value={kpis.hm.toLocaleString('es-CL')} />
        <Kpi icon={<Gauge />} label="% Cumplimiento" value={`${kpis.cumpl}%`} />
        <Kpi icon={<ClipboardList />} label="OT incompletas" value={kpis.incompletas} tone={kpis.incompletas ? 'warning' : undefined} />
        <Kpi icon={<Clock />} label="Por aprobar" value={kpis.porAprobar} tone={kpis.porAprobar ? 'info' : undefined} />
      </div>

      {/* FILA 2 · Tendencia + Embudo de estados */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartCard title="Consumo histórico · HH por día" icon={<TrendingUp className="h-4 w-4" />}>
          {hhByDay.length === 0 ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={hhByDay}>
                <defs>
                  <linearGradient id="hhFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} allowDecimals={false} />
                <RTooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="hh" name="HH" stroke="hsl(var(--primary))" strokeWidth={3} fill="url(#hhFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Estado de los Reportes Diarios" icon={<FileText className="h-4 w-4" />}>
          {statusFunnel.length === 0 ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={statusFunnel} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} />
                <Bar dataKey="value" name="Reportes" fill="hsl(var(--primary))" radius={[0, 8, 8, 0]} barSize={18}>
                  <LabelList dataKey="value" position="right" style={{ fill: 'hsl(var(--foreground))', fontSize: 11, fontWeight: 700 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* FILA 3 · HH por especialidad + Consumo por área (financiero, solo gerencia) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ChartCard title="HH por especialidad" icon={<Users className="h-4 w-4" />}>
          {hhBySpecialty.length === 0 ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={hhBySpecialty} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} innerRadius={55} paddingAngle={2}>
                  {hhBySpecialty.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <RTooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <Legend items={hhBySpecialty.slice(0, 6).map((s, i) => ({ label: s.name, color: PALETTE[i % PALETTE.length], value: `${s.value} HH` }))} />
        </ChartCard>

        {isManagement ? (
          <ChartCard title="Consumo de materiales por área (costo estimado)" icon={<Package className="h-4 w-4" />}>
            {costByArea.length === 0 ? <ChartEmpty hint="Sin costos: las OT usan material como texto libre y no calzan con el catálogo." /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={costByArea}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} tickFormatter={(v) => CLP.format(v)} width={80} />
                  <RTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => CLP.format(Number(v))} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} />
                  <Bar dataKey="value" name="Costo estimado" fill="hsl(var(--info))" radius={[8, 8, 0, 0]} barSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        ) : (
          <ChartCard title="Top materiales utilizados" icon={<Package className="h-4 w-4" />}>
            <TopMaterialsList items={topMaterials} showCost={false} />
          </ChartCard>
        )}
      </div>

      {/* FILA 4 · Tablas accionables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-5 space-y-4">
            <SectionTitle icon={<ClipboardList className="h-4 w-4" />} title="OT incompletas / en curso" count={otIncompletas.length} />
            <DataTable
              columns={otCols}
              data={otIncompletas}
              rowKey={(o) => o.id}
              isLoading={isLoading}
              onRowClick={(o) => router.push(`/dashboard/work-reports/ot/${o.id}`)}
              empty={{ icon: <CheckCircle2 size={20} />, title: 'Todo al día', description: 'No hay OT incompletas en el período.' }}
            />
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem]">
          <CardContent className="p-5 space-y-4">
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="Reportes Diarios por aprobar" count={porAprobar.length} />
            <DataTable
              columns={reportCols}
              data={porAprobar}
              rowKey={(r) => r.id}
              isLoading={isLoading}
              onRowClick={(r) => router.push(`/dashboard/work-reports/${r.id}`)}
              empty={{ icon: <CheckCircle2 size={20} />, title: 'Sin pendientes', description: 'No hay reportes esperando firma.' }}
            />
          </CardContent>
        </Card>
      </div>

      {/* FILA 5 · Herramientas + Top materiales (gerencia) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-5 space-y-4">
            <SectionTitle icon={<Hammer className="h-4 w-4" />} title="Herramientas pendientes de devolución" count={toolsOut.length} />
            <DataTable
              columns={toolCols}
              data={toolsOut.slice(0, 12)}
              rowKey={(l) => l.id}
              isLoading={isLoading}
              empty={{ icon: <CheckCircle2 size={20} />, title: 'Todo devuelto', description: 'No hay herramientas prestadas sin devolver.' }}
            />
          </CardContent>
        </Card>

        {isManagement && (
          <Card className="rounded-[1.5rem]">
            <CardContent className="p-5 space-y-4">
              <SectionTitle icon={<Package className="h-4 w-4" />} title="Top materiales utilizados" count={topMaterials.length} />
              <TopMaterialsList items={topMaterials} showCost />
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

// ── Columnas de tablas ───────────────────────────────────────────────────────
const otCols: DataTableColumn<WorkOrder>[] = [
  { key: 'ot', header: 'OT', cell: (o) => <span className="font-bold">{o.otNumber || '—'}</span> },
  { key: 'area', header: 'Área', cell: (o) => o.area || '—' },
  { key: 'sup', header: 'Supervisor', cell: (o) => o.supervisorName || '—' },
  { key: 'exec', header: 'Avance', cell: (o) => <span className="font-bold tabular-nums">{Number(o.executedPercent || 0)}%</span> },
  { key: 'st', header: 'Estado', cell: (o) => <Badge className="rounded-xl">{o.status === 'ready' ? 'Lista' : 'Borrador'}</Badge> },
];

const REPORT_BADGE: Record<WorkReport['status'], string> = {
  draft: 'bg-muted text-muted-foreground', pending_review: 'badge-info', observed: 'badge-warning',
  operations_approved: 'badge-info', final_approved: 'badge-success', archived: 'bg-muted text-muted-foreground',
};
const reportCols: DataTableColumn<WorkReport>[] = [
  { key: 'code', header: 'Código', cell: (r) => <span className="font-bold">{r.internalCode}</span> },
  { key: 'area', header: 'Faena / Área', cell: (r) => `${r.faena || '—'} / ${r.area || '—'}` },
  { key: 'sup', header: 'Supervisor', cell: (r) => r.supervisorName || '—' },
  { key: 'st', header: 'Estado', cell: (r) => <Badge className={`rounded-xl ${REPORT_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</Badge> },
];

const toolCols: DataTableColumn<ToolLog>[] = [
  { key: 'tool', header: 'Herramienta', cell: (l) => <span className="font-bold">{l.toolName}</span> },
  { key: 'user', header: 'Asignada a', cell: (l) => l.userName || '—' },
  { key: 'date', header: 'Salida', cell: (l) => fmtDate(l.checkoutDate) },
  {
    key: 'days', header: 'Días', className: 'text-right', headerClassName: 'text-right',
    cell: (l) => {
      const d = differenceInDays(new Date(), new Date(l.checkoutDate as any));
      const days = isNaN(d) ? 0 : Math.max(0, d);
      return <span className={`font-bold tabular-nums ${days > 7 ? 'text-destructive' : ''}`}>{days}</span>;
    },
  },
];

// ── Componentes de presentación ──────────────────────────────────────────────
function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="rounded-xl h-9 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => <SelectItem key={v} value={v} className="text-xs">{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const TONE_CLASS: Record<string, string> = {
  warning: 'bg-warning-subtle text-warning-subtle-foreground',
  info: 'bg-info-subtle text-info-subtle-foreground',
  destructive: 'bg-destructive/10 text-destructive',
};

function Kpi({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-4 space-y-3">
        <div className={`p-2 rounded-xl w-fit [&_svg]:h-4 [&_svg]:w-4 ${tone ? TONE_CLASS[tone] : 'bg-primary/10 text-primary'}`}>{icon}</div>
        <div className="text-2xl font-black tabular-nums">{value}</div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function AlertChip({ tone, icon, label }: { tone: string; icon: React.ReactNode; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold ${TONE_CLASS[tone]}`}>
      {icon}{label}
    </div>
  );
}

function ChartCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          <span className="text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>{title}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon, title, count }: { icon: React.ReactNode; title: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        <span className="text-primary [&_svg]:h-4 [&_svg]:w-4">{icon}</span>{title}
      </div>
      <Badge variant="outline" className="rounded-xl tabular-nums">{count}</Badge>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; value: string }[] }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
      {items.map((it) => (
        <div key={it.label} className="flex items-center gap-1.5 text-[11px]">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
          <span className="text-muted-foreground">{it.label}</span>
          <span className="font-bold tabular-nums">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

function TopMaterialsList({ items, showCost }: { items: { name: string; qty: number; unit: string; cost: number }[]; showCost: boolean }) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Sin materiales registrados en el período.</p>;
  }
  const max = Math.max(...items.map((i) => i.qty), 1);
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div key={it.name} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium truncate pr-2">{it.name}</span>
            <span className="tabular-nums shrink-0 text-muted-foreground">
              {it.qty.toLocaleString('es-CL')} {it.unit}{showCost && it.cost > 0 ? ` · ${CLP.format(it.cost)}` : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(it.qty / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartEmpty({ hint }: { hint?: string }) {
  return (
    <div className="h-[260px] flex flex-col items-center justify-center text-center gap-1.5 text-muted-foreground">
      <Gauge className="h-7 w-7 opacity-40" />
      <p className="text-sm">Sin datos en el período seleccionado.</p>
      {hint && <p className="text-xs max-w-xs">{hint}</p>}
    </div>
  );
}
