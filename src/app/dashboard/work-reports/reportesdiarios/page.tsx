'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format, isToday, isThisWeek, isThisMonth } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, CheckCircle2, ClipboardList, Clock, FileText, Plus, Trash2, Users, Wrench } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppState } from '@/modules/core/contexts/app-provider';
import { useAuth } from '@/modules/auth/useAuth';
import type { WorkReport } from '@/modules/core/lib/data';
import { WORK_REPORT_STATUS_LABEL as STATUS_LABEL } from '@/modules/core/lib/work-report-labels';
import { dailyEffectiveTotals } from '@/modules/core/lib/work-order-consolidation';

const STATUS_BADGE: Record<WorkReport['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'badge-info',
  observed: 'badge-warning',
  operations_approved: 'badge-info',
  final_approved: 'badge-success',
  archived: 'bg-muted text-muted-foreground',
};

// Evita el corrimiento de un día por zona horaria que produce
// `new Date('YYYY-MM-DD')` (se parsea como UTC medianoche).
function parseDateOnly(value: any): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmtDate(d: Date | string) {
  const date = parseDateOnly(d) || new Date(d as any);
  if (isNaN(date.getTime())) return '-';
  return format(date, 'dd MMM yyyy', { locale: es });
}

export default function ReportesDiariosPage() {
  const router = useRouter();
  const { workReports, workOrders, createWorkReport, deleteWorkReport, can, isLoading, notify } = useAppState();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super-admin';
  const reports = workReports || [];
  const [toDelete, setToDelete] = React.useState<WorkReport | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [period, setPeriod] = React.useState<'all' | 'week' | 'month'>('all');

  const stats = useMemo(() => {
    const today = reports.filter((r) => isToday(new Date(r.createdAt as any))).length;
    const pending = reports.filter((r) => r.status === 'pending_review').length;
    const observed = reports.filter((r) => r.status === 'observed').length;
    const finished = reports.filter((r) => r.status === 'final_approved').length;
    // Reusa el mismo cálculo que el módulo Semanal (dailyEffectiveTotals): si el
    // Diario consolida OT, las HH/HM salen de ahí (congeladas si ya se envió a
    // revisión) — leer `r.labor`/`r.equipment` directo de la fila da ~0 para
    // cualquier Diario en modo cascada, que es el flujo actual del módulo.
    let hh = 0;
    let hm = 0;
    for (const r of reports) {
      const t = dailyEffectiveTotals(r, workOrders || []);
      hh += t.hh;
      hm += t.hm;
    }
    const avg = reports.length ? Math.round(reports.reduce((s, r) => s + Number(r.progressPercent || 0), 0) / reports.length) : 0;
    return { today, pending, observed, finished, hh: Math.round(hh * 100) / 100, hm: Math.round(hm * 100) / 100, avg };
  }, [reports, workOrders]);

  const filteredReports = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports.filter((r) => {
      if (period !== 'all') {
        const d = parseDateOnly(r.workDate);
        if (!d) return false;
        if (period === 'week' && !isThisWeek(d, { weekStartsOn: 1 })) return false;
        if (period === 'month' && !isThisMonth(d)) return false;
      }
      if (!q) return true;
      const otNums = (r.dailyOts || []).map((o) => o.otNumber).join(' ');
      return [r.internalCode, r.otNumber, otNums, r.supervisorName, r.faena, r.area, r.client]
        .some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [reports, query, period]);

  const handleNew = async () => {
    try {
      const report = await createWorkReport({});
      sessionStorage.setItem(`wr_new_${report.id}`, JSON.stringify(report));
      router.push(`/dashboard/work-reports/${report.id}`);
    } catch (error: any) {
      notify(error?.message || 'No se pudo crear el reporte de trabajo.', 'destructive');
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteWorkReport(toDelete.id);
      notify('Informe eliminado.', 'success');
    } catch (error: any) {
      notify(error?.message || 'No se pudo eliminar el informe.', 'destructive');
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  const columns: DataTableColumn<WorkReport>[] = [
    { key: 'code', header: 'Codigo', cell: (r) => <span className="font-bold">{r.internalCode}</span> },
    {
      key: 'ot',
      header: 'OT',
      cell: (r) => {
        // Modo cascada: la cabecera legacy `otNumber` casi nunca se llena — las
        // OT reales del día viven en `dailyOts`.
        const nums = (r.dailyOts || []).map((o) => o.otNumber).filter((n): n is string => !!n?.trim());
        if (nums.length === 0) return r.otNumber || '-';
        return (
          <span title={nums.join(', ')}>
            {nums[0]}{nums.length > 1 && <span className="text-muted-foreground"> +{nums.length - 1}</span>}
          </span>
        );
      },
    },
    { key: 'site', header: 'Faena / Area', cell: (r) => <span>{r.faena || '-'} / {r.area || '-'}</span> },
    { key: 'supervisor', header: 'Supervisor', cell: (r) => r.supervisorName || '-' },
    { key: 'date', header: 'Fecha', cell: (r) => fmtDate(r.workDate) },
    { key: 'progress', header: 'Avance', cell: (r) => <span className="font-bold tabular-nums">{r.progressPercent}%</span> },
    {
      key: 'status',
      header: 'Estado',
      cell: (r) => <Badge className={`rounded-xl ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'actions', header: '', headerClassName: 'text-right', className: 'text-right',
      cell: (r) => {
        // Un Diario ya enviado a revisión (o más allá) queda protegido de
        // borrado accidental — puede tener firmas de aprobación. Solo
        // super-admin puede saltarse esto (mismo criterio que el servidor).
        const canDeleteThis = can('work_reports:delete') && (isSuperAdmin || r.status === 'draft' || r.status === 'observed');
        return canDeleteThis ? (
          <Button
            variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null;
      },
    },
  ];

  return (
    <PageShell
      title="Reportes Diarios"
      description="Informe diario de terreno (consolida las OT del día), fotografías, recursos y aprobaciones."
      toolbar={
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto sm:items-center sm:justify-end">
          <Input className="rounded-xl sm:w-56" placeholder="Buscar código, OT, supervisor…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
            <SelectTrigger className="rounded-xl sm:w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el historial</SelectItem>
              <SelectItem value="week">Esta semana</SelectItem>
              <SelectItem value="month">Este mes</SelectItem>
            </SelectContent>
          </Select>
          {can('work_reports:create') && (
            <Button onClick={handleNew} className="rounded-[1.5rem] shadow-lg shadow-primary/10">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Reporte Diario
            </Button>
          )}
        </div>
      }
    >
      <div className="grid grid-cols-2 xl:grid-cols-7 gap-4">
        <Kpi icon={<FileText />} label="Creados hoy" value={stats.today} />
        <Kpi icon={<Clock />} label="Pendientes" value={stats.pending} />
        <Kpi icon={<ClipboardList />} label="Observados" value={stats.observed} />
        <Kpi icon={<CheckCircle2 />} label="Finalizados" value={stats.finished} />
        <Kpi icon={<Users />} label="HH acumuladas" value={stats.hh} />
        <Kpi icon={<Wrench />} label="HM acumuladas" value={stats.hm} />
        <Kpi icon={<BarChart3 />} label="Avance promedio" value={`${stats.avg}%`} />
      </div>

      <DataTable
        columns={columns}
        data={filteredReports}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => router.push(`/dashboard/work-reports/${r.id}`)}
        empty={{
          icon: <ClipboardList size={22} />,
          title: reports.length ? 'Sin resultados' : 'Sin informes de terreno',
          description: reports.length ? 'Prueba con otro término o período.' : 'Crea el primer reporte desde celular o computador.',
        }}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el informe {toDelete?.internalCode}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción eliminará el informe y sus fotos de forma permanente. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" disabled={deleting} onClick={confirmDelete}>
              {deleting ? 'Eliminando…' : 'Sí, eliminar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <Card className="rounded-[1.5rem]">
      <CardContent className="p-4 space-y-3">
        <div className="p-2 rounded-xl bg-primary/10 text-primary w-fit [&_svg]:h-4 [&_svg]:w-4">{icon}</div>
        <div className="text-2xl font-black tabular-nums">{value}</div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
