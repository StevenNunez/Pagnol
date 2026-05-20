
"use client";

import React, { useMemo } from 'react';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Construction, Inbox, Clock, ThumbsUp, ThumbsDown, AlertCircle, MessageSquare } from 'lucide-react';
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
        case 'pending-quality-review': return { label: 'En Revisión', icon: Clock, color: 'bg-yellow-500/80' };
        case 'completed': return { label: 'Aprobado', icon: ThumbsUp, color: 'bg-green-600' };
        case 'rejected': return { label: 'Rechazado', icon: ThumbsDown, color: 'bg-red-600' };
        default: return { label: 'En Progreso', icon: Construction, color: 'bg-gray-500' };
    }
};

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return null;
    const d = date instanceof Date ? date : new Date(date as any);
    return formatDistanceToNow(d, { addSuffix: true, locale: es });
};

export default function MisProtocolosPage() {
    const { user, can } = useAuth();
    const { workItems } = useAppState();

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
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Mis Protocolos"
                description="Estado de las partidas que has finalizado y enviado a revisión de calidad."
            />

            <Tabs defaultValue="all" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="all">Todos ({myProtocols.length})</TabsTrigger>
                    <TabsTrigger value="pending-quality-review">En Revisión ({byStatus('pending-quality-review').length})</TabsTrigger>
                    <TabsTrigger value="completed">Aprobados ({byStatus('completed').length})</TabsTrigger>
                    <TabsTrigger value="rejected">Rechazados ({byStatus('rejected').length})</TabsTrigger>
                </TabsList>

                {['all', 'pending-quality-review', 'completed', 'rejected'].map(tab => (
                    <TabsContent key={tab} value={tab}>
                        <ProtocolList protocols={tab === 'all' ? myProtocols : byStatus(tab)} />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
}

function ProtocolList({ protocols }: { protocols: WorkItem[] }) {
    if (protocols.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-12 border-2 border-dashed rounded-lg bg-card mt-4">
                <Inbox className="h-16 w-16 mb-4 opacity-50" />
                <h3 className="text-xl font-semibold">Sin Protocolos</h3>
                <p className="mt-2">No hay partidas en esta categoría.</p>
            </div>
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
                                    className={`p-4 border rounded-lg flex flex-col gap-3 hover:bg-muted/50 transition-colors ${isRejected ? 'border-red-200 bg-red-50/50' : ''}`}
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                        <div className="flex-grow min-w-0">
                                            <p className="font-semibold text-foreground truncate">{item.path} — {item.name}</p>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {item.quantity.toLocaleString()} {item.unit}
                                                {item.actualEndDate && (
                                                    <span> · Enviado {formatDate(item.actualEndDate)}</span>
                                                )}
                                            </p>
                                        </div>
                                        <Badge className={`${statusInfo.color} text-white shrink-0`}>
                                            <StatusIcon className="mr-1.5 h-3.5 w-3.5" />
                                            {statusInfo.label}
                                        </Badge>
                                    </div>

                                    {isRejected && item.rejectionReason && (
                                        <div className="flex items-start gap-2 p-3 bg-red-100 rounded-md text-red-700">
                                            <MessageSquare className="h-4 w-4 mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest mb-0.5">Motivo del rechazo</p>
                                                <p className="text-sm">{item.rejectionReason}</p>
                                            </div>
                                        </div>
                                    )}

                                    {isRejected && (
                                        <Link href="/dashboard/construction-control/wbs">
                                            <Button size="sm" variant="outline" className="text-xs border-red-200 text-red-600 hover:bg-red-50 w-full sm:w-auto">
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
