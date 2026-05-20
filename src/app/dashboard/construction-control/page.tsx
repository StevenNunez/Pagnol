'use client';

import React, { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { useAuth, useAppState } from '@/modules/core/contexts/app-provider';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  Clock,
  FolderTree,
  GanttChartSquare,
  HardHat,
  ListChecks,
  TrendingUp,
  Activity,
  ArrowRight,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';
import { WorkItem, ProgressLog } from '@/modules/core/lib/data';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

export default function ConstructionControlHubPage() {
  const { can } = useAuth();
  const { workItems, progressLogs } = useAppState();

  const stats = useMemo(() => {
    const items = workItems || [];

    const hasChildren = (id: string) => items.some(w => w.parentId === id);
    const leafItems = items.filter(item => !hasChildren(item.id));

    const totalQty = leafItems.reduce((s, i) => s + (i.quantity || 0), 0);
    const overallProgress = totalQty > 0
      ? leafItems.reduce((s, i) => s + (i.quantity || 0) * (i.progress || 0) / 100, 0) / totalQty * 100
      : leafItems.length > 0
        ? leafItems.reduce((s, i) => s + (i.progress || 0), 0) / leafItems.length
        : 0;

    const completed  = items.filter(i => i.status === 'completed').length;
    const pending    = items.filter(i => i.status === 'pending-quality-review').length;
    const inProgress = items.filter(i => i.status === 'in-progress').length;
    const rejected   = items.filter(i => i.status === 'rejected').length;

    const phases = items
      .filter(i => i.type === 'phase')
      .map(phase => {
        const phaseLeafs = leafItems.filter(
          i => i.path.startsWith(phase.path + '/') || i.path === phase.path
        );
        const pQty = phaseLeafs.reduce((s, i) => s + (i.quantity || 0), 0);
        const progress = pQty > 0
          ? phaseLeafs.reduce((s, i) => s + (i.quantity || 0) * (i.progress || 0) / 100, 0) / pQty * 100
          : phaseLeafs.length > 0
            ? phaseLeafs.reduce((s, i) => s + (i.progress || 0), 0) / phaseLeafs.length
            : 0;
        return { id: phase.id, name: phase.name, path: phase.path, progress };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    const pendingItems = items
      .filter(i => i.status === 'pending-quality-review')
      .sort((a, b) => (a.actualEndDate?.getTime() || 0) - (b.actualEndDate?.getTime() || 0))
      .slice(0, 5);

    const rejectedItems = items
      .filter(i => i.status === 'rejected')
      .slice(0, 3);

    return { overallProgress, completed, pending, inProgress, rejected, phases, pendingItems, rejectedItems };
  }, [workItems]);

  const recentActivity = useMemo(() => {
    if (!progressLogs || !workItems) return [];
    const wMap = new Map((workItems || []).map(i => [i.id, i]));
    return [...progressLogs]
      .sort((a, b) => new Date(b.date as any).getTime() - new Date(a.date as any).getTime())
      .slice(0, 6)
      .map(log => ({
        ...log,
        workItemName: wMap.get(log.workItemId)?.name ?? 'Partida',
        workItemUnit: wMap.get(log.workItemId)?.unit ?? '',
      }));
  }, [progressLogs, workItems]);

  if (!can('module_construction_control:view')) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Acceso Denegado</AlertTitle>
        <AlertDescription>No tienes permisos para acceder a este módulo.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <PageHeader
        title="Control de Obra"
        description="Panel de seguimiento del avance físico del proyecto."
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="col-span-2 lg:col-span-1 rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
          <CardContent className="p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Avance General</p>
            <p className="text-4xl font-black text-primary">{stats.overallProgress.toFixed(1)}%</p>
            <Progress value={stats.overallProgress} className="h-2 mt-3" />
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <HardHat size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.inProgress}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">En Progreso</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
              <Clock size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.pending}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">En Revisión</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.completed}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Completadas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Centro */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Avance por Fase — col 3 */}
        <Card className="lg:col-span-3 rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
              <TrendingUp className="h-4 w-4 text-primary" /> Avance por Fase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {stats.phases.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No hay fases definidas.</p>
            ) : (
              stats.phases.map(phase => (
                <div key={phase.id} className="space-y-1.5">
                  <div className="flex justify-between items-center gap-2">
                    <p className="text-sm font-semibold truncate">{phase.name}</p>
                    <span className={`text-xs font-bold font-mono shrink-0 ${phase.progress >= 100 ? 'text-green-600' : 'text-muted-foreground'}`}>
                      {phase.progress.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={phase.progress} className="h-2" />
                </div>
              ))
            )}
            <Link href="/dashboard/construction-control/wbs" className="block pt-1">
              <Button variant="outline" size="sm" className="w-full gap-2 text-xs">
                <FolderTree size={13} /> Ver EDT completo
                <ArrowRight size={13} className="ml-auto" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {/* Columna derecha — col 2 */}
        <div className="lg:col-span-2 flex flex-col gap-6">

          {/* Pendientes de Revisión */}
          <Card className="flex-1 rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
                  <ListChecks className="h-4 w-4 text-amber-500" /> Pendientes
                </CardTitle>
                {stats.pending > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px]">{stats.pending}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {stats.pendingItems.length === 0 ? (
                <div className="flex items-center gap-2 py-3 text-green-600">
                  <CheckCircle2 size={16} />
                  <p className="text-xs font-semibold">Sin protocolos pendientes</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {stats.pendingItems.map(item => (
                    <div key={item.id} className="flex items-center gap-2 py-2 border-b last:border-0">
                      <Clock size={13} className="text-amber-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate">{item.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{item.path}</p>
                      </div>
                    </div>
                  ))}
                  {can('construction_control:review_protocols') && (
                    <Link href="/dashboard/construction-control/revisar-protocolos" className="block pt-1">
                      <Button variant="outline" size="sm" className="w-full gap-2 text-xs border-amber-200 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">
                        <CheckSquare size={13} /> Revisar ahora
                        <ArrowRight size={13} className="ml-auto" />
                      </Button>
                    </Link>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rechazadas */}
          {stats.rejected > 0 && (
            <Card className="rounded-[1.5rem] border-none shadow-lg bg-red-50 dark:bg-red-900/20">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-red-600 dark:text-red-400">
                  <XCircle className="h-4 w-4" /> Rechazadas ({stats.rejected})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.rejectedItems.map(item => (
                  <div key={item.id} className="flex items-center gap-2">
                    <XCircle size={12} className="text-red-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{item.path}</p>
                    </div>
                  </div>
                ))}
                <Link href="/dashboard/construction-control/wbs" className="block pt-1">
                  <Button variant="outline" size="sm" className="w-full gap-2 text-xs border-red-200 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                    Corregir en EDT <ArrowRight size={13} className="ml-auto" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Actividad Reciente */}
      <Card className="rounded-[1.5rem] border-none shadow-lg bg-slate-100 dark:bg-slate-800/70">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
              <Activity className="h-4 w-4 text-primary" /> Actividad Reciente
            </CardTitle>
            <Link href="/dashboard/construction-control/wbs">
              <Button variant="ghost" size="sm" className="text-xs gap-1 text-muted-foreground">
                Registrar Avance <ArrowRight size={12} />
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin registros de avance aún.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {recentActivity.map(log => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-background/60 border border-border/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <TrendingUp size={13} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black truncate">{log.workItemName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-bold text-foreground">+{log.quantity} {log.workItemUnit}</span> — {log.userName}
                    </p>
                    {log.observations && (
                      <p className="text-[10px] text-muted-foreground italic truncate">"{log.observations}"</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(log.date as any), { addSuffix: true, locale: es })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Accesos Rápidos */}
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard/construction-control/wbs">
          <Button variant="outline" className="gap-2 rounded-xl">
            <FolderTree size={15} /> Partidas (EDT)
          </Button>
        </Link>
        <Link href="/dashboard/construction-control/gantt">
          <Button variant="outline" className="gap-2 rounded-xl">
            <GanttChartSquare size={15} /> Carta Gantt
          </Button>
        </Link>
        <Link href="/dashboard/construction-control/protocolos">
          <Button variant="outline" className="gap-2 rounded-xl border-primary/30 text-primary hover:bg-primary/5">
            <CheckSquare size={15} /> Protocolos de Calidad
          </Button>
        </Link>
        {can('construction_control:review_protocols') && (
          <Link href="/dashboard/construction-control/revisar-protocolos">
            <Button variant="outline" className="gap-2 rounded-xl border-amber-200 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20">
              <CheckSquare size={15} /> Revisar EDT
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
