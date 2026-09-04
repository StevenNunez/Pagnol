
"use client";

import React, { useMemo } from 'react';
import { PageShell } from '@/components/page-shell';
import { EmptyState } from '@/components/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Construction, Clock, ThumbsUp, ThumbsDown, AlertCircle, MessageSquare } from 'lucide-react';
import { useAppState, useAuth } from '@/modules/core/contexts/app-provider';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WorkItem } from '@/modules/core/lib/data';
import { formatDistanceToNow, format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const getStatusInfo = (status: string): { label: string; icon: React.ElementType; color: string } => {
    switch (status) {
        case 'pending-quality-review': return { label: 'En Revisión', icon: Clock, color: 'bg-warning text-warning-foreground' };
        case 'completed': return { label: 'Aprobado', icon: ThumbsUp, color: 'bg-success text-success-foreground' };
        case 'rejected': return { label: 'Rechazado', icon: ThumbsDown, color: 'bg-destructive text-destructive-foreground' };
        default: return { label: 'En Progreso', icon: Construction, color: 'bg-muted-foreground text-background' };
    }
};

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date as any);
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
};

export default function MisProtocolosPage() {
    const { user, can } = useAuth();
    const { workItems, workProjects } = useAppState();

    // Un mismo trabajador puede tener partidas en varias obras, y el código de
    // EDT se repite entre obras: sin el nombre de la obra, dos filas idénticas
    // pueden ser trabajos totalmente distintos.
    const obraDe = useMemo(
        () => new Map((workProjects || []).map(p => [p.id, p.name])),
        [workProjects],
    );

    const myProtocols = useMemo(() => {
        if (!workItems || !user) return [];
        return workItems
            .filter((item: WorkItem) =>
                (item.status === 'pending-quality-review' ||
                    item.status === 'completed' ||
                    item.status === 'rejected') &&
                (item.assignedTo === user.id || item.createdBy === user.id)
            )
            .sort((a, b) => (b.actualEndDate?.getTime() || 0) - (a.actualEndDate?.getTime() || 0));
    }, [workItems, user]);

    const byStatus = (status: string) => myProtocols.filter(p => p.status === status);

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
            title="Mis Partidas Enviadas"
            description="Estado de las partidas que has finalizado y enviado a revisión de calidad."
        >
            <Tabs defaultValue="all" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="all">Todos ({myProtocols.length})</TabsTrigger>
                    <TabsTrigger value="pending-quality-review">En Revisión ({byStatus('pending-quality-review').length})</TabsTrigger>
                    <TabsTrigger value="completed">Aprobados ({byStatus('completed').length})</TabsTrigger>
                    <TabsTrigger value="rejected">Rechazados ({byStatus('rejected').length})</TabsTrigger>
                </TabsList>

                {['all', 'pending-quality-review', 'completed', 'rejected'].map(tab => (
                    <TabsContent key={tab} value={tab}>
                        <ProtocolList protocols={tab === 'all' ? myProtocols : byStatus(tab)} obraDe={obraDe} />
                    </TabsContent>
                ))}
            </Tabs>
        </PageShell>
    );
}

function ProtocolList({ protocols, obraDe }: { protocols: WorkItem[]; obraDe: Map<string, string> }) {
    if (protocols.length === 0) {
        return (
            <EmptyState
                icon={<Construction size={24} />}
                title="Sin partidas"
                description="No hay partidas en esta categoría."
                className="mt-4"
            />
        );
    }

    return (
        <Card className="mt-4">
            <CardContent className="p-0">
                <ScrollArea className="h-[calc(80vh-16rem)]">
                    <div className="space-y-3 p-4">
                        {protocols.map(item => {
                            const statusInfo = getStatusInfo(item.status);
                            const StatusIcon = statusInfo.icon;
                            const isRejected = item.status === 'rejected';
                            return (
                                <div
                                    key={item.id}
                                    className={`p-4 border rounded-lg flex flex-col gap-3 hover:bg-muted/50 transition-colors ${isRejected ? 'border-destructive/30 bg-destructive/5' : ''}`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                        <div className="flex-grow min-w-0">
                                            {obraDe.get(item.workProjectId ?? '') && (
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">
                                                    {obraDe.get(item.workProjectId ?? '')}
                                                </p>
                                            )}
                                            <p className="font-semibold text-foreground truncate">{item.path} — {item.name}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {item.quantity.toLocaleString()} {item.unit}
                                                {item.actualEndDate && (
                                                    <span> · Enviado {formatDate(item.actualEndDate)}</span>
                                                )}
                                            </p>
                                        </div>
                                        <Badge className={`${statusInfo.color} shrink-0`}>
                                            <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
                                            {statusInfo.label}
                                        </Badge>
                                    </div>

                                    {isRejected && item.rejectionReason && (
                                        <div className="flex items-start gap-2 p-3 bg-destructive/10 rounded-md text-destructive">
                                            <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest mb-0.5">Motivo del rechazo</p>
                                                <p className="text-sm">{item.rejectionReason}</p>
                                            </div>
                                        </div>
                                    )}

                                    {isRejected && (
                                        <Link href="/dashboard/construction-control/wbs">
                                            <Button size="sm" variant="outline" className="text-xs border-destructive/30 text-destructive hover:bg-destructive/10 w-full sm:w-auto">
                                                Corregir en EDT →
                                            </Button>
                                        </Link>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
