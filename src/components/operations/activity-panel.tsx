'use client';

import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Activity, ArrowRight, CalendarClock, CheckCircle2, CheckSquare, CircleDashed, ListChecks } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ProgressLog, WorkItem } from '@/modules/core/lib/data';
import { activityBucket, forecastCompletion, overdueDays, type Forecast } from '@/lib/construction-forecast';

/**
 * "Qué está pasando en la obra hoy".
 *
 * Antes el panel solo listaba las partidas **pendientes de revisión**: cinco
 * nombres sin fecha ni avance. No respondía la pregunta que hace cualquiera que
 * abre el panel —qué se está ejecutando ahora y para cuándo termina—, así que
 * había que entrar al EDT y abrir partida por partida.
 *
 * La fecha que se muestra en cada fila se **proyecta con el ritmo real** de la
 * partida cuando hay avance registrado; si no lo hay, se muestra la planificada,
 * y siempre se dice cuál de las dos es (`construction-forecast.ts`). Presentar
 * una proyección como si fuera una fecha comprometida sería el peor resultado
 * posible: se ve igual de creíble y se planifica sobre ella.
 */

type Row = {
    item: WorkItem;
    forecast: Forecast;
    overdue: number;
};

const fmt = (d: Date) => {
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return format(d, sameYear ? "d 'de' MMM" : "d MMM yyyy", { locale: es });
};

function DateCell({ forecast, overdue }: { forecast: Forecast; overdue: number }) {
    if (!forecast.date) {
        return <span className="text-[10px] text-muted-foreground">Sin fecha</span>;
    }

    const late = forecast.deviationDays !== null && forecast.deviationDays > 0;
    const early = forecast.deviationDays !== null && forecast.deviationDays < 0;

    return (
        <div className="text-right shrink-0">
            <p className={`text-xs font-bold tabular-nums ${late ? 'text-destructive' : early ? 'text-success' : 'text-foreground'}`}>
                {fmt(forecast.date)}
            </p>
            <p className="text-[10px] text-muted-foreground">
                {forecast.kind === 'projected' ? 'Proyectada' : 'Planificada'}
                {late && ` · +${forecast.deviationDays}d`}
                {early && ` · ${forecast.deviationDays}d`}
            </p>
            {/* Una proyección hecha con un solo día de historia extrapola de un
                único punto. Se muestra igual —es la mejor estimación que hay—
                pero diciendo sobre qué se apoya. */}
            {forecast.kind === 'projected' && forecast.basisDays === 1 && (
                <p className="text-[10px] text-warning">1 día de datos</p>
            )}
            {overdue > 0 && forecast.kind !== 'projected' && (
                <p className="text-[10px] font-bold text-destructive">Vencida hace {overdue}d</p>
            )}
        </div>
    );
}

function ActivityRow({ row, showProgress = true }: { row: Row; showProgress?: boolean }) {
    const { item, forecast, overdue } = row;
    return (
        <div className="flex items-center gap-3 py-2.5 border-b last:border-0">
            <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate" title={item.name}>{item.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{item.path}</p>
                {showProgress && (
                    <div className="flex items-center gap-2 mt-1.5">
                        <Progress value={item.progress || 0} className="h-1.5 flex-1" />
                        <span className="text-[10px] font-bold tabular-nums text-muted-foreground w-9 text-right">
                            {(item.progress || 0).toFixed(0)}%
                        </span>
                    </div>
                )}
            </div>
            <DateCell forecast={forecast} overdue={overdue} />
        </div>
    );
}

function TabCount({ n }: { n: number }) {
    return <span className="ml-1.5 text-[10px] font-black tabular-nums opacity-70">{n}</span>;
}

function Empty({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-2 py-6 text-muted-foreground justify-center">
            <CheckCircle2 size={15} className="text-success" />
            <p className="text-xs font-semibold">{text}</p>
        </div>
    );
}

interface ActivityPanelProps {
    /** Partidas hoja de la obra activa (las que se miden). */
    leafItems: WorkItem[];
    progressLogs: ProgressLog[];
    canReview: boolean;
}

export function ActivityPanel({ leafItems, progressLogs, canReview }: ActivityPanelProps) {
    const { running, notStarted, pending, lateCount } = React.useMemo(() => {
        const today = new Date();

        // Primer avance de cada partida: es el inicio real desde el que se mide
        // el ritmo (una partida puede haber empezado tarde respecto al plan).
        const firstLog = new Map<string, Date>();
        for (const log of progressLogs || []) {
            const d = log.date instanceof Date ? log.date : new Date(log.date as string);
            if (Number.isNaN(d.getTime())) continue;
            const prev = firstLog.get(log.workItemId);
            if (!prev || d < prev) firstLog.set(log.workItemId, d);
        }

        const toRow = (item: WorkItem): Row => ({
            item,
            forecast: forecastCompletion(
                {
                    progress: item.progress || 0,
                    plannedStartDate: item.plannedStartDate,
                    plannedEndDate: item.plannedEndDate,
                    actualStartDate: item.actualStartDate,
                    firstProgressDate: firstLog.get(item.id) ?? null,
                },
                today,
            ),
            overdue: overdueDays({ progress: item.progress || 0, plannedEndDate: item.plannedEndDate }, today),
        });

        const running: Row[] = [];
        const notStarted: Row[] = [];
        const pending: Row[] = [];

        for (const item of leafItems) {
            const bucket = activityBucket({ status: item.status, progress: item.progress || 0 });
            if (bucket === 'running') running.push(toRow(item));
            else if (bucket === 'notStarted') notStarted.push(toRow(item));
            else if (bucket === 'pending') pending.push(toRow(item));
        }

        // Lo más atrasado arriba: es lo que hay que mirar primero. Las partidas
        // sin fecha van al final — no compiten con las que sí tienen desviación.
        const byUrgency = (a: Row, b: Row) => {
            const da = a.forecast.deviationDays ?? (a.overdue || Number.NEGATIVE_INFINITY);
            const db = b.forecast.deviationDays ?? (b.overdue || Number.NEGATIVE_INFINITY);
            return db - da;
        };
        running.sort(byUrgency);

        notStarted.sort((a, b) => {
            const da = a.item.plannedStartDate ? new Date(a.item.plannedStartDate).getTime() : Number.POSITIVE_INFINITY;
            const db = b.item.plannedStartDate ? new Date(b.item.plannedStartDate).getTime() : Number.POSITIVE_INFINITY;
            return da - db;
        });

        const lateCount = running.filter(
            r => (r.forecast.deviationDays !== null && r.forecast.deviationDays > 0) || r.overdue > 0,
        ).length;

        return { running, notStarted, pending, lateCount };
    }, [leafItems, progressLogs]);

    return (
        <Card className="flex-1 rounded-[1.5rem] border-none shadow-lg bg-card">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-tight">
                        <Activity className="h-4 w-4 text-primary" /> Actividades
                    </CardTitle>
                    {lateCount > 0 && (
                        <Badge className="bg-destructive text-destructive-foreground text-[10px]">
                            {lateCount} atrasada{lateCount > 1 ? 's' : ''}
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent>
                <Tabs defaultValue="running">
                    <TabsList className="rounded-xl w-full grid grid-cols-3">
                        <TabsTrigger value="running" className="rounded-lg text-[11px]">
                            En ejecución<TabCount n={running.length} />
                        </TabsTrigger>
                        <TabsTrigger value="notStarted" className="rounded-lg text-[11px]">
                            Por iniciar<TabCount n={notStarted.length} />
                        </TabsTrigger>
                        <TabsTrigger value="pending" className="rounded-lg text-[11px]">
                            En revisión<TabCount n={pending.length} />
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="running" className="mt-3">
                        {running.length === 0 ? (
                            <Empty text="Ninguna partida en ejecución" />
                        ) : (
                            <>
                                {running.slice(0, 6).map(row => <ActivityRow key={row.item.id} row={row} />)}
                                {running.length > 6 && (
                                    <p className="pt-2 text-[10px] text-muted-foreground text-center">
                                        y {running.length - 6} más en ejecución
                                    </p>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="notStarted" className="mt-3">
                        {notStarted.length === 0 ? (
                            <Empty text="Todo lo planificado ya arrancó" />
                        ) : (
                            <>
                                {notStarted.slice(0, 6).map(row => (
                                    <div key={row.item.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                                        <CircleDashed size={13} className="text-muted-foreground shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold truncate" title={row.item.name}>{row.item.name}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">{row.item.path}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {row.item.plannedStartDate ? (
                                                <>
                                                    <p className="text-xs font-bold tabular-nums">
                                                        {fmt(new Date(row.item.plannedStartDate))}
                                                    </p>
                                                    <p className="text-[10px] text-muted-foreground">Inicio planificado</p>
                                                </>
                                            ) : (
                                                <span className="text-[10px] text-muted-foreground">Sin fecha</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {notStarted.length > 6 && (
                                    <p className="pt-2 text-[10px] text-muted-foreground text-center">
                                        y {notStarted.length - 6} más por iniciar
                                    </p>
                                )}
                            </>
                        )}
                    </TabsContent>

                    <TabsContent value="pending" className="mt-3">
                        {pending.length === 0 ? (
                            <Empty text="Sin partidas esperando revisión" />
                        ) : (
                            <>
                                {pending.slice(0, 6).map(row => (
                                    <div key={row.item.id} className="flex items-center gap-3 py-2.5 border-b last:border-0">
                                        <ListChecks size={13} className="text-warning shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-semibold truncate" title={row.item.name}>{row.item.name}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">{row.item.path}</p>
                                        </div>
                                        {row.item.actualEndDate && (
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-bold tabular-nums">{fmt(new Date(row.item.actualEndDate))}</p>
                                                <p className="text-[10px] text-muted-foreground">Terminada en terreno</p>
                                            </div>
                                        )}
                                    </div>
                                ))}
                                {canReview && (
                                    <Link href="/dashboard/construction-control/revisar-protocolos" className="block pt-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="w-full gap-2 text-xs border-warning/30 text-warning hover:bg-warning-subtle"
                                        >
                                            <CheckSquare size={13} /> Revisar ahora
                                            <ArrowRight size={13} className="ml-auto" />
                                        </Button>
                                    </Link>
                                )}
                            </>
                        )}
                    </TabsContent>
                </Tabs>

                <Link href="/dashboard/construction-control/gantt" className="block pt-3">
                    <Button variant="ghost" size="sm" className="w-full gap-2 text-xs text-muted-foreground">
                        <CalendarClock size={13} /> Ver el cronograma completo
                        <ArrowRight size={13} className="ml-auto" />
                    </Button>
                </Link>
            </CardContent>
        </Card>
    );
}
