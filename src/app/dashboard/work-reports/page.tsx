'use client';

// ─────────────────────────────────────────────────────────────────────────────
// CENTRO OPERATIVO · OT y Reportes de Trabajo
// Punto de entrada del módulo, centrado en el ciclo OT → Diario → Semanal.
// No es un panel de BI: es el lugar donde supervisor, jefe y ADC ven qué
// requiere SU acción hoy (firmas pendientes, OT atrasadas) y miden HH/HM del
// período. Todo se computa client-side desde useAppState(); sin APIs nuevas.
//
// FUENTE DE VERDAD para HH/HM = OT (work_orders), la capa granular de la
// cascada. Los Reportes Diarios/Semanales consolidan OT y aportan el embudo
// de estados y aprobaciones — no se vuelven a sumar HH ahí para no doblar el
// conteo (un Diario consolida sus OT, un Semanal consolida sus Diarios).
//
// Fuera de alcance a propósito: herramientas sin devolver, stock crítico,
// consumo de materiales — eso vive en el módulo Pañol/Bodega.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, startOfDay, startOfMonth, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ResponsiveContainer, LabelList, Legend as RLegend,
} from 'recharts';
import {
  FileText, ClipboardList, Users, Wrench, AlertTriangle, CheckCircle2, Clock,
  CalendarRange, Gauge, TrendingUp, Plus, Tags, ArrowRight, Signature, PenLine,
} from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import type { WorkOrder, WorkReport } from '@/modules/core/lib/data';
import { WORK_REPORT_STATUS_LABEL as STATUS_LABEL } from '@/modules/core/lib/work-report-labels';

type Period = 'today' | 'week' | 'month' | 'year' | 'all';
const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoy', week: 'Últimos 7 días', month: 'Este mes', year: 'Este año', all: 'Histórico',
};

const PALETTE = [
  'hsl(var(--primary))', 'hsl(var(--info))', 'hsl(var(--success))',
  'hsl(var(--warning))', 'hsl(var(--destructive))', 'hsl(var(--muted-foreground))',
];

const TOOLTIP_STYLE = {
  borderRadius: '16px', border: 'none',
  boxShadow: '0 25px 50px -12px rgba(0,0,0,0.15)', background: 'hsl(var(--card))',
  color: 'hsl(var(--foreground))', fontSize: 11,
} as const;

// Todas las fechas del módulo (workDate, startDate) son date-only ('YYYY-MM-DD').
// Comparar como texto evita el corrimiento de un día por zona horaria que da
// `new Date('YYYY-MM-DD')` (se parsea como UTC medianoche).
function dateOnlyStr(value: any): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value as any);
  if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseDateOnly(value: any): Date | null {
  const s = dateOnlyStr(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function fmtDateOnly(value: any) {
  const d = parseDateOnly(value);
  return d ? format(d, 'dd MMM', { locale: es }) : '—';
}

function inPeriod(d: Date | string | undefined | null, period: Period, todayStr: string): boolean {
  if (period === 'all') return true;
  if (!d) return false;
  const s = dateOnlyStr(d);
  if (!s) return false;
  if (period === 'today') return s === todayStr;
  const date = parseDateOnly(d);
  if (!date) return false;
  const now = new Date();
  if (period === 'week') return date >= subDays(startOfDay(now), 6);
  if (period === 'month') return date >= startOfMonth(now);
  if (period === 'year') return date.getFullYear() === now.getFullYear();
  return true;
}

// HH (horas hombre) / HM (horas máquina) declaradas en una OT.
const otHH = (ot: WorkOrder) => (ot.labor || []).reduce((a, l) => a + (Number(l.hours) || 0), 0);
const otHM = (ot: WorkOrder) => (ot.equipment || []).reduce((a, e) => a + (Number(e.hours) || 0), 0);

export default function WorkReportsOperationalHub() {
  const router = useRouter();
  const { workOrders, workReports, workWeeklyReports, workReportAreas, workReportSpecialties, can, isLoading } = useAppState();
  const { user } = useAuth();

  const [period, setPeriod] = useState<Period>('month');
  const [area, setArea] = useState<string>('all');
  const [specialty, setSpecialty] = useState<string>('all');
  const [supervisor, setSupervisor] = useState<string>('all');

  const orders = workOrders || [];
  const reports = workReports || [];
  const weeklies = workWeeklyReports || [];
  const todayStr = dateOnlyStr(new Date());

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
    return { areas: [...areas].sort(), specialties: [...specs].sort(), supervisors: [...sups].sort() };
  }, [workReportAreas, workReportSpecialties, orders, reports]);

  // Alcance por filtros estructurales (área/especialidad/supervisor), SIN
  // período — lo usan el pulso operativo y "requiere tu acción", que son
  // siempre "ahora", no un rango histórico.
  const scopedOrders = useMemo(() => orders.filter((o) =>
    (area === 'all' || o.area === area) && (specialty === 'all' || o.specialty === specialty) && (supervisor === 'all' || o.supervisorName === supervisor)
  ), [orders, area, specialty, supervisor]);
  const scopedReports = useMemo(() => reports.filter((r) =>
    (area === 'all' || r.area === area) && (specialty === 'all' || r.specialty === specialty) && (supervisor === 'all' || r.supervisorName === supervisor)
  ), [reports, area, specialty, supervisor]);

  // OT y Diarios filtrados por período + filtros globales — para analítica.
  const fOrders = useMemo(() => scopedOrders.filter((o) => inPeriod(o.workDate, period, todayStr)), [scopedOrders, period, todayStr]);
  const fReports = useMemo(() => scopedReports.filter((r) => inPeriod(r.workDate, period, todayStr)), [scopedReports, period, todayStr]);
  const fWeeklies = useMemo(() => weeklies.filter((w) => inPeriod(w.startDate, period, todayStr)), [weeklies, period, todayStr]);

  // ── Pulso operativo de hoy (siempre "ahora", no depende del período) ──────
  const otAtrasadas = useMemo(
    () => scopedOrders.filter((o) => dateOnlyStr(o.workDate) < todayStr && Number(o.executedPercent || 0) < 100),
    [scopedOrders, todayStr],
  );
  const otHoy = useMemo(() => scopedOrders.filter((o) => dateOnlyStr(o.workDate) === todayStr), [scopedOrders, todayStr]);
  const otListas = useMemo(() => scopedOrders.filter((o) => o.status === 'ready'), [scopedOrders]);
  const diariosBorrador = useMemo(() => scopedReports.filter((r) => r.status === 'draft'), [scopedReports]);
  const diariosObservados = useMemo(() => scopedReports.filter((r) => r.status === 'observed'), [scopedReports]);
  const semanalesBorrador = useMemo(() => weeklies.filter((w) => w.status === 'draft'), [weeklies]);

  // ── Requiere tu acción (personalizado por identidad + permiso) ────────────
  const misOtAtrasadas = useMemo(() => otAtrasadas.filter((o) => o.supervisorId === user?.id), [otAtrasadas, user?.id]);
  const misDiariosObservados = useMemo(() => diariosObservados.filter((r) => r.supervisorId === user?.id), [diariosObservados, user?.id]);
  const canReviewOps = can('work_reports:review_operations');
  const canFinalApprove = can('work_reports:final_approve');
  const diariosEsperandoOperaciones = useMemo(
    () => (canReviewOps ? scopedReports.filter((r) => r.status === 'pending_review' && !r.operationsApprovedAt) : []),
    [canReviewOps, scopedReports],
  );
  const diariosEsperandoAdc = useMemo(
    () => (canFinalApprove ? scopedReports.filter((r) => r.status === 'pending_review' && !r.finalApprovedAt) : []),
    [canFinalApprove, scopedReports],
  );
  const semanalesEsperandoFirma = useMemo(
    () => (canReviewOps ? weeklies.filter((w) => w.status === 'ready' && !(w.signatures || []).some((s) => s.step === 'operations')) : []),
    [canReviewOps, weeklies],
  );
  interface ActionItem { icon: React.ReactNode; label: string; count: number; href: string; tone: 'warning' | 'info' }
  const rawActionItems: (ActionItem | false)[] = [
    misOtAtrasadas.length > 0 && { icon: <ClipboardList className="h-4 w-4" />, label: `${misOtAtrasadas.length} OT propias atrasadas`, count: misOtAtrasadas.length, href: '/dashboard/work-reports/ot', tone: 'warning' },
    misDiariosObservados.length > 0 && { icon: <AlertTriangle className="h-4 w-4" />, label: `${misDiariosObservados.length} Diarios propios observados`, count: misDiariosObservados.length, href: '/dashboard/work-reports/reportesdiarios', tone: 'warning' },
    diariosEsperandoOperaciones.length > 0 && { icon: <Signature className="h-4 w-4" />, label: `${diariosEsperandoOperaciones.length} Diarios esperando tu firma (Operaciones)`, count: diariosEsperandoOperaciones.length, href: '/dashboard/work-reports/reportesdiarios', tone: 'info' },
    diariosEsperandoAdc.length > 0 && { icon: <Signature className="h-4 w-4" />, label: `${diariosEsperandoAdc.length} Diarios esperando tu firma (ADC)`, count: diariosEsperandoAdc.length, href: '/dashboard/work-reports/reportesdiarios', tone: 'info' },
    semanalesEsperandoFirma.length > 0 && { icon: <PenLine className="h-4 w-4" />, label: `${semanalesEsperandoFirma.length} Semanales esperando tu firma`, count: semanalesEsperandoFirma.length, href: '/dashboard/work-reports/semanal', tone: 'info' },
  ];
  const actionItems = rawActionItems.filter((x): x is ActionItem => !!x);

  // ── Pipeline del módulo (período) ─────────────────────────────────────────
  const consolidatedOtIds = useMemo(() => new Set(fReports.flatMap((r) => r.consolidatedOrderIds || [])), [fReports]);
  const otConsolidadas = useMemo(() => fOrders.filter((o) => consolidatedOtIds.has(o.id)).length, [fOrders, consolidatedOtIds]);
  const statusFunnel = useMemo(() => {
    const order: WorkReport['status'][] = ['draft', 'pending_review', 'observed', 'operations_approved', 'final_approved', 'archived'];
    return order.map((s) => ({ name: STATUS_LABEL[s], value: fReports.filter((r) => r.status === s).length })).filter((x) => x.value > 0);
  }, [fReports]);
  const weeklyByStatus = useMemo(() => ({
    draft: fWeeklies.filter((w) => w.status === 'draft').length,
    ready: fWeeklies.filter((w) => w.status === 'ready').length,
  }), [fWeeklies]);

  // ── Medición HH / HM (período) ────────────────────────────────────────────
  const kpis = useMemo(() => {
    const hh = fOrders.reduce((a, o) => a + otHH(o), 0);
    const hm = fOrders.reduce((a, o) => a + otHM(o), 0);
    const cumpl = fOrders.length ? Math.round(fOrders.reduce((a, o) => a + Number(o.executedPercent || 0), 0) / fOrders.length) : 0;
    return { hh: Math.round(hh * 100) / 100, hm: Math.round(hm * 100) / 100, cumpl };
  }, [fOrders]);

  const hhByDay = useMemo(() => {
    const byDay = new Map<string, { date: Date; hh: number; hm: number }>();
    fOrders.forEach((o) => {
      const d = parseDateOnly(o.workDate);
      if (!d) return;
      const key = dateOnlyStr(o.workDate);
      const cur = byDay.get(key) || { date: d, hh: 0, hm: 0 };
      cur.hh += otHH(o); cur.hm += otHM(o);
      byDay.set(key, cur);
    });
    return [...byDay.values()]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((v) => ({ name: format(v.date, 'dd MMM', { locale: es }), HH: Math.round(v.hh * 100) / 100, HM: Math.round(v.hm * 100) / 100 }));
  }, [fOrders]);

  const hhBySpecialty = useMemo(() => {
    const map = new Map<string, number>();
    fOrders.forEach((o) => { const k = o.specialty || 'Sin especialidad'; map.set(k, (map.get(k) || 0) + otHH(o)); });
    return [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [fOrders]);

  const hhByArea = useMemo(() => {
    const map = new Map<string, number>();
    fOrders.forEach((o) => { const k = o.area || 'Sin área'; map.set(k, (map.get(k) || 0) + otHH(o)); });
    return [...map.entries()].map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  }, [fOrders]);

  // ── Tablas accionables ─────────────────────────────────────────────────────
  const otAtrasadasTabla = useMemo(() => [...otAtrasadas].sort((a, b) => dateOnlyStr(a.workDate).localeCompare(dateOnlyStr(b.workDate))).slice(0, 12), [otAtrasadas]);
  const porAprobar = useMemo(() => fReports.filter((r) => r.status === 'pending_review' || r.status === 'operations_approved' || r.status === 'observed'), [fReports]);

  return (
    <PageShell
      title="Centro Operativo · OT y Reportes"
      description="El ciclo OT → Diario → Semanal: qué requiere tu acción hoy, y cómo va la medición de HH/HM del período."
      toolbar={
        <div className="w-full flex flex-col xl:flex-row gap-3 xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            <QuickLink icon={<Plus className="h-3.5 w-3.5" />} label="OT" href="/dashboard/work-reports/ot" />
            <QuickLink icon={<FileText className="h-3.5 w-3.5" />} label="Diarios" href="/dashboard/work-reports/reportesdiarios" />
            <QuickLink icon={<CalendarRange className="h-3.5 w-3.5" />} label="Semanales" href="/dashboard/work-reports/semanal" />
            <QuickLink icon={<Tags className="h-3.5 w-3.5" />} label="Catálogos" href="/dashboard/work-reports/catalogos" />
          </div>
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
      {/* Requiere tu acción — personalizado por identidad/rol, siempre "ahora" */}
      {actionItems.length > 0 && (
        <Card className="rounded-[1.5rem] border-primary/30">
          <CardContent className="p-5 space-y-3">
            <SectionTitle icon={<AlertTriangle className="h-4 w-4" />} title="Requiere tu acción" count={actionItems.length} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {actionItems.map((it, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => router.push(it.href)}
                  className={`flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-sm font-bold transition hover:opacity-80 ${TONE_CLASS[it.tone]}`}
                >
                  <span className="flex items-center gap-2">{it.icon}{it.label}</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pulso operativo de hoy */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Pulso operativo · hoy</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <Kpi icon={<ClipboardList />} label="OT de hoy" value={otHoy.length} onClick={() => router.push('/dashboard/work-reports/ot')} />
          <Kpi icon={<Clock />} label="OT atrasadas" value={otAtrasadas.length} tone={otAtrasadas.length ? 'warning' : undefined} onClick={() => router.push('/dashboard/work-reports/ot')} />
          <Kpi icon={<CheckCircle2 />} label="OT listas p/ consolidar" value={otListas.length} onClick={() => router.push('/dashboard/work-reports/ot')} />
          <Kpi icon={<FileText />} label="Diarios en borrador" value={diariosBorrador.length} onClick={() => router.push('/dashboard/work-reports/reportesdiarios')} />
          <Kpi icon={<AlertTriangle />} label="Diarios observados" value={diariosObservados.length} tone={diariosObservados.length ? 'warning' : undefined} onClick={() => router.push('/dashboard/work-reports/reportesdiarios')} />
          <Kpi icon={<CalendarRange />} label="Semanales en borrador" value={semanalesBorrador.length} onClick={() => router.push('/dashboard/work-reports/semanal')} />
        </div>
      </div>

      {/* Medición HH/HM del período */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Medición · {PERIOD_LABEL[period]}</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <Kpi icon={<ClipboardList />} label="OT del período" value={fOrders.length} />
          <Kpi icon={<FileText />} label="Reportes Diarios" value={fReports.length} />
          <Kpi icon={<CalendarRange />} label="Reportes Semanales" value={fWeeklies.length} />
          <Kpi icon={<Users />} label="HH totales" value={kpis.hh.toLocaleString('es-CL')} />
          <Kpi icon={<Wrench />} label="HM totales" value={kpis.hm.toLocaleString('es-CL')} />
          <Kpi icon={<Gauge />} label="% Cumplimiento" value={`${kpis.cumpl}%`} />
        </div>
      </div>

      {/* Pipeline del módulo */}
      <Card className="rounded-[1.5rem]">
        <CardContent className="p-5 space-y-4">
          <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Pipeline del módulo — OT → Diario → Semanal" count={fOrders.length + fReports.length + fWeeklies.length} />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <PipelineStage label="OT" total={fOrders.length}
              rows={[['Consolidadas en un Diario', otConsolidadas], ['Sueltas', fOrders.length - otConsolidadas], ['Listas', otListas.length]]} />
            <PipelineStage label="Reportes Diarios" total={fReports.length}
              rows={statusFunnel.map((s) => [s.name, s.value] as [string, number])} />
            <PipelineStage label="Reportes Semanales" total={fWeeklies.length}
              rows={[['Borrador', weeklyByStatus.draft], ['Listo (firmado)', weeklyByStatus.ready]]} />
          </div>
        </CardContent>
      </Card>

      {/* Tendencia HH/HM */}
      <ChartCard title="HH y HM por día" icon={<TrendingUp className="h-4 w-4" />}>
        {hhByDay.length === 0 ? <ChartEmpty /> : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={hhByDay}>
              <defs>
                <linearGradient id="hhFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="hmFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--info))" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="hsl(var(--info))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} dy={8} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} allowDecimals={false} />
              <RTooltip contentStyle={TOOLTIP_STYLE} />
              <RLegend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="HH" stroke="hsl(var(--primary))" strokeWidth={3} fill="url(#hhFill)" />
              <Area type="monotone" dataKey="HM" stroke="hsl(var(--info))" strokeWidth={3} fill="url(#hmFill)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* HH por especialidad + HH por área */}
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

        <ChartCard title="HH por área" icon={<ClipboardList className="h-4 w-4" />}>
          {hhByArea.length === 0 ? <ChartEmpty /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={hhByArea}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground) / 0.15)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} allowDecimals={false} />
                <RTooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'hsl(var(--muted-foreground) / 0.08)' }} />
                <Bar dataKey="value" name="HH" fill="hsl(var(--primary))" radius={[8, 8, 0, 0]} barSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Tablas accionables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="rounded-[1.5rem]">
          <CardContent className="p-5 space-y-4">
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="OT atrasadas" count={otAtrasadas.length} />
            <DataTable
              columns={otCols}
              data={otAtrasadasTabla}
              rowKey={(o) => o.id}
              isLoading={isLoading}
              onRowClick={(o) => router.push(`/dashboard/work-reports/ot/${o.id}`)}
              empty={{ icon: <CheckCircle2 size={20} />, title: 'Todo al día', description: 'No hay OT atrasadas.' }}
            />
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem]">
          <CardContent className="p-5 space-y-4">
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="Reportes Diarios por aprobar" count={porAprobar.length} />
            <DataTable
              columns={buildReportCols(canReviewOps, canFinalApprove)}
              data={porAprobar}
              rowKey={(r) => r.id}
              isLoading={isLoading}
              onRowClick={(r) => router.push(`/dashboard/work-reports/${r.id}`)}
              empty={{ icon: <CheckCircle2 size={20} />, title: 'Sin pendientes', description: 'No hay reportes esperando firma.' }}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}

// ── Columnas de tablas ───────────────────────────────────────────────────────
const otCols: DataTableColumn<WorkOrder>[] = [
  { key: 'ot', header: 'OT', cell: (o) => <span className="font-bold">{o.otNumber || '—'}</span> },
  { key: 'date', header: 'Fecha', cell: (o) => fmtDateOnly(o.workDate) },
  { key: 'area', header: 'Área', cell: (o) => o.area || '—' },
  { key: 'sup', header: 'Supervisor', cell: (o) => o.supervisorName || '—' },
  { key: 'exec', header: 'Avance', cell: (o) => <span className="font-bold tabular-nums">{Number(o.executedPercent || 0)}%</span> },
];

const REPORT_BADGE: Record<WorkReport['status'], string> = {
  draft: 'bg-muted text-muted-foreground', pending_review: 'badge-info', observed: 'badge-warning',
  operations_approved: 'badge-info', final_approved: 'badge-success', archived: 'bg-muted text-muted-foreground',
};
function buildReportCols(canReviewOps: boolean, canFinalApprove: boolean): DataTableColumn<WorkReport>[] {
  return [
    { key: 'code', header: 'Código', cell: (r) => <span className="font-bold">{r.internalCode}</span> },
    { key: 'area', header: 'Faena / Área', cell: (r) => `${r.faena || '—'} / ${r.area || '—'}` },
    { key: 'sup', header: 'Supervisor', cell: (r) => r.supervisorName || '—' },
    { key: 'st', header: 'Estado', cell: (r) => <Badge className={`rounded-xl ${REPORT_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</Badge> },
    {
      key: 'turn', header: 'Turno', cell: (r) => {
        if (r.status !== 'pending_review') return null;
        const waitingOps = canReviewOps && !r.operationsApprovedAt;
        const waitingAdc = canFinalApprove && !r.finalApprovedAt;
        if (!waitingOps && !waitingAdc) return null;
        return <Badge variant="outline" className="rounded-lg text-[10px]">Te toca a ti</Badge>;
      },
    },
  ];
}

// ── Componentes de presentación ──────────────────────────────────────────────
function QuickLink({ icon, label, href }: { icon: React.ReactNode; label: string; href: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold hover:border-primary/40 hover:bg-primary/5 transition"
    >
      {icon}{label}
    </button>
  );
}

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

function Kpi({ icon, label, value, tone, onClick }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string; onClick?: () => void }) {
  return (
    <Card className={`rounded-[1.5rem] ${onClick ? 'cursor-pointer hover:border-primary/40 transition-colors' : ''}`} onClick={onClick}>
      <CardContent className="p-4 space-y-3">
        <div className={`p-2 rounded-xl w-fit [&_svg]:h-4 [&_svg]:w-4 ${tone ? TONE_CLASS[tone] : 'bg-primary/10 text-primary'}`}>{icon}</div>
        <div className="text-2xl font-black tabular-nums">{value}</div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
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

function PipelineStage({ label, total, rows }: { label: string; total: number; rows: [string, number][] }) {
  return (
    <div className="rounded-xl border p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-lg font-black tabular-nums">{total}</span>
      </div>
      <div className="space-y-1">
        {rows.filter(([, v]) => v > 0).map(([name, value]) => (
          <div key={name} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground truncate pr-2">{name}</span>
            <span className="font-bold tabular-nums shrink-0">{value}</span>
          </div>
        ))}
        {rows.every(([, v]) => v === 0) && <p className="text-xs text-muted-foreground">Sin datos.</p>}
      </div>
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
