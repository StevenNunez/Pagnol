'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, isToday } from 'date-fns';
import { es } from 'date-fns/locale';
import { BarChart3, CheckCircle2, ClipboardList, Clock, FileText, Plus, Users, Wrench } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAppState } from '@/modules/core/contexts/app-provider';
import type { WorkReport } from '@/modules/core/lib/data';

const STATUS_LABEL: Record<WorkReport['status'], string> = {
  draft: 'Borrador',
  pending_review: 'Pendiente revision',
  observed: 'Observado',
  operations_approved: 'Aprobado operaciones',
  final_approved: 'Aprobado final',
  archived: 'Archivado',
};

const STATUS_BADGE: Record<WorkReport['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_review: 'badge-info',
  observed: 'badge-warning',
  operations_approved: 'badge-info',
  final_approved: 'badge-success',
  archived: 'bg-muted text-muted-foreground',
};

export default function WorkReportsDashboard() {
  const router = useRouter();
  const { workReports, createWorkReport, can, isLoading, notify } = useAppState();
  const reports = workReports || [];

  const stats = useMemo(() => {
    const today = reports.filter((r) => isToday(new Date(r.createdAt as any))).length;
    const pending = reports.filter((r) => r.status === 'pending_review').length;
    const observed = reports.filter((r) => r.status === 'observed').length;
    const finished = reports.filter((r) => r.status === 'final_approved').length;
    const hh = reports.reduce((s, r) => s + (r.labor || []).reduce((a, l) => a + Number(l.hours || 0), 0), 0);
    const hm = reports.reduce((s, r) => s + (r.equipment || []).reduce((a, e) => a + Number(e.hours || 0), 0), 0);
    const avg = reports.length ? Math.round(reports.reduce((s, r) => s + Number(r.progressPercent || 0), 0) / reports.length) : 0;
    return { today, pending, observed, finished, hh, hm, avg };
  }, [reports]);

  const handleNew = async () => {
    try {
      const report = await createWorkReport({});
      router.push(`/dashboard/work-reports/${report.id}`);
    } catch (error: any) {
      notify(error?.message || 'No se pudo crear el reporte de trabajo.', 'destructive');
    }
  };

  const columns: DataTableColumn<WorkReport>[] = [
    { key: 'code', header: 'Codigo', cell: (r) => <span className="font-bold">{r.internalCode}</span> },
    { key: 'ot', header: 'OT', cell: (r) => r.otNumber || '-' },
    { key: 'site', header: 'Faena / Area', cell: (r) => <span>{r.faena || '-'} / {r.area || '-'}</span> },
    { key: 'supervisor', header: 'Supervisor', cell: (r) => r.supervisorName || '-' },
    { key: 'date', header: 'Fecha', cell: (r) => fmtDate(r.workDate) },
    { key: 'progress', header: 'Avance', cell: (r) => <span className="font-bold tabular-nums">{r.progressPercent}%</span> },
    {
      key: 'status',
      header: 'Estado',
      cell: (r) => <Badge className={`rounded-xl ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</Badge>,
    },
  ];

  return (
    <PageShell
      title="Reportes de Trabajo"
      description="Informes diarios de terreno, fotografias, recursos y aprobaciones."
      toolbar={
        <div className="w-full flex justify-end">
          {can('work_reports:create') && (
            <Button onClick={handleNew} className="rounded-[1.5rem] shadow-lg shadow-primary/10">
              <Plus className="h-4 w-4 mr-2" />
              Nuevo Reporte de Trabajo
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
        data={reports}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => router.push(`/dashboard/work-reports/${r.id}`)}
        empty={{
          icon: <ClipboardList size={22} />,
          title: 'Sin informes de terreno',
          description: 'Crea el primer reporte desde celular o computador.',
        }}
      />
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

function fmtDate(d: Date | string) {
  const date = new Date(d as any);
  if (isNaN(date.getTime())) return '-';
  return format(date, 'dd MMM yyyy', { locale: es });
}
