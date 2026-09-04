'use client';

import React, { useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
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
import { activityBucket, rollupProgress } from '@/lib/construction-forecast';
import { ProjectSwitcher, useActiveProject, useProjectWorkItems } from '@/components/operations/active-project';
import { ActivityPanel } from '@/components/operations/activity-panel';
import { SCurveCard } from '@/components/operations/s-curve-card';
import { PortfolioCard } from '@/components/operations/portfolio-card';
import { es } from 'date-fns/locale';

export default function ConstructionControlHubPage() {
  const { can } = useAuth();
  const { workItems: allWorkItems, progressLogs } = useAppState();
  const { project, projects } = useActiveProject();
  // El "Avance General" promediaba TODAS las obras del inquilino en un solo
  // número, que no significaba nada con más de una obra abierta (RFC-006 F1).
  const workItems = useProjectWorkItems(allWorkItems);

  const stats = useMemo(() => {
    const items = workItems || [];

    const hasChildren = (id: string) => items.some(w => w.parentId === id);
    const leafItems = items.filter(item => !hasChildren(item.id));

    const overallProgress = rollupProgress(leafItems);

    // Los contadores hablan de PARTIDAS medibles (hojas), no de fases: una fase
    // no "está en progreso" por sí misma, lo están las partidas que cuelgan de
    // ella. Contando todo, el panel decía "21 en progreso" justo encima de una
    // tarjeta que listaba 5 — el mismo hecho con dos números distintos.
    //
    // Se clasifica con `activityBucket`, el MISMO criterio que usa la tarjeta de
    // Actividades, así los cuatro números suman exactamente las partidas de la
    // obra. Contarlos por separado ya hacía que una partida al 100% esperando
    // revisión apareciera a la vez como "en revisión" y como "completada".
    const buckets = leafItems.map(i => activityBucket({ status: i.status, progress: i.progress || 0 }));
    const contar = (b: string) => buckets.filter(x => x === b).length;
    const completed  = contar('done');
    const pending    = contar('pending');
    const inProgress = contar('running') + contar('notStarted');
    const rejected   = contar('rejected');

    const phases = items
      .filter(i => i.type === 'phase')
      .map(phase => {
        const phaseLeafs = leafItems.filter(
          i => i.path.startsWith(phase.path + '/') || i.path === phase.path
        );
        const progress = rollupProgress(phaseLeafs);
        return { id: phase.id, name: phase.name, path: phase.path, progress };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    const rejectedItems = items
      .filter(i => i.status === 'rejected')
      .slice(0, 3);

    return { overallProgress, completed, pending, inProgress, rejected, phases, rejectedItems, leafItems };
  }, [workItems]);

  const recentActivity = useMemo(() => {
    if (!progressLogs || !workItems) return [];
    const wMap = new Map((workItems || []).map(i => [i.id, i]));
    return [...progressLogs]
      .filter(log => wMap.has(log.workItemId))
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
    <PageShell
      title="Control de Obras"
      description={project ? `Avance físico de ${project.name}.` : 'Panel de seguimiento del avance físico.'}
      toolbar={<ProjectSwitcher />}
    >
      {projects.length === 0 ? (
        <EmptyState
          icon={<HardHat size={22} />}
          title="Todavía no hay obras"
          description="Crea una obra en Partidas (EDT) para empezar a seguir su avance."
          action={
            <Link href="/dashboard/construction-control/wbs">
              <Button variant="outline" className="gap-2 rounded-xl">
                Ir a Partidas (EDT) <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          }
        />
      ) : (
      <>
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="col-span-2 lg:col-span-1 rounded-[1.5rem] border-none shadow-lg bg-card">
          <CardContent className="p-6">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Avance General</p>
            <p className="text-4xl font-black text-primary">{stats.overallProgress.toFixed(1)}%</p>
            <Progress value={stats.overallProgress} className="h-2 mt-3" />
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-info-subtle text-info-subtle-foreground shrink-0">
              <HardHat size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.inProgress}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">En Progreso</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-warning-subtle text-warning-subtle-foreground shrink-0">
              <Clock size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.pending}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">En Revisión</p>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
          <CardContent className="p-6 flex items-center gap-4">
            <div className="p-3 rounded-2xl bg-success-subtle text-success-subtle-foreground shrink-0">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <p className="text-2xl font-black">{stats.completed}</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Completadas</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <SCurveCard leafItems={stats.leafItems} progressLogs={progressLogs || []} />

      {/* Centro */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Avance por Fase — col 3 */}
        <Card className="lg:col-span-3 rounded-[1.5rem] border-none shadow-lg bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
              <TrendingUp className="h-4 w-4 text-primary" /> Avance por Fase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {stats.phases.length === 0 ? (
              <EmptyState className="border-0 py-8" title="No hay fases definidas." />
            ) : (
              stats.phases.map(phase => (
                <div key={phase.id} className="space-y-1.5">
                  <div className="flex justify-between items-center gap-2">
                    <p className="text-sm font-semibold truncate">{phase.name}</p>
                    <span className={`text-xs font-bold font-mono shrink-0 ${phase.progress >= 100 ? 'text-success' : 'text-muted-foreground'}`}>
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

          <PortfolioCard allWorkItems={allWorkItems || []} />

          <ActivityPanel
            leafItems={stats.leafItems}
            progressLogs={progressLogs || []}
            canReview={can('construction_control:review_protocols')}
          />

          {/* Rechazadas */}
          {stats.rejected > 0 && (
            <Card className="rounded-[1.5rem] border-none shadow-lg bg-destructive/10">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight text-destructive">
                  <XCircle className="h-4 w-4" /> Rechazadas ({stats.rejected})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stats.rejectedItems.map(item => (
                  <div key={item.id} className="flex items-start gap-2">
                    <XCircle size={12} className="text-destructive shrink-0 mt-1" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{item.path}</p>
                      {/* El motivo es la única información accionable de esta
                          tarjeta: sin él dice qué falló pero no por qué. */}
                      {item.rejectionReason && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{item.rejectionReason}</p>
                      )}
                    </div>
                  </div>
                ))}
                <Link href="/dashboard/construction-control/wbs" className="block pt-1">
                  <Button variant="outline" size="sm" className="w-full gap-2 text-xs border-destructive/30 text-destructive hover:bg-destructive/10">
                    Corregir en EDT <ArrowRight size={13} className="ml-auto" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Actividad Reciente */}
      <Card className="rounded-[1.5rem] border-none shadow-lg bg-card">
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
            <Button variant="outline" className="gap-2 rounded-xl border-warning/30 text-warning hover:bg-warning-subtle">
              <CheckSquare size={15} /> Aprobar Partidas
            </Button>
          </Link>
        )}
      </div>
      </>
      )}
    </PageShell>
  );
}
