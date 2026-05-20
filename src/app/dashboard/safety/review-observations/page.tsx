
"use client";

import React, { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Inbox, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { BehaviorObservation } from "@/modules/core/lib/data";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return jsDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ReviewBehaviorObservationsPage() {
    const { behaviorObservations, isLoading } = useAppState();

    const sortedObservations = useMemo(() => {
        if (!behaviorObservations) return [];
        return [...behaviorObservations].sort((a, b) => {
            const dateA = new Date(a.observationDate as any).getTime();
            const dateB = new Date(b.observationDate as any).getTime();
            return dateB - dateA;
        });
    }, [behaviorObservations]);

    const getRiskBadge = (level: string | null) => {
        switch (level) {
            case 'aceptable': return <Badge variant="default" className="bg-green-600 dark:bg-green-700">Aceptable</Badge>;
            case 'leve': return <Badge variant="secondary" className="bg-yellow-500 dark:bg-yellow-600 text-white">Leve</Badge>;
            case 'grave': return <Badge variant="destructive" className="bg-orange-600 dark:bg-orange-700">Grave</Badge>;
            case 'gravisimo': return <Badge variant="destructive">Gravísimo</Badge>;
            default: return <Badge variant="outline">N/A</Badge>;
        }
    };

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Revisión de Observaciones de Conducta"
                description="Aquí puedes ver todos los formularios de observación de conducta que se han registrado."
            />

            <Card>
                <CardHeader>
                    <CardTitle>Historial de Observaciones</CardTitle>
                    <CardDescription>
                        Selecciona una observación para ver los detalles completos y descargar el informe en PDF.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[calc(80vh-12rem)] border rounded-md">
                        {sortedObservations.length > 0 ? (
                            <div className="space-y-3 p-4">
                                {sortedObservations.map((obs: BehaviorObservation) => (
                                    <Link key={obs.id} href={`/dashboard/safety/review-observations/${obs.id}`} >
                                        <div className="p-4 border rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-muted/50 transition-colors cursor-pointer">
                                            <div className="flex-grow">
                                                <h4 className="font-semibold">Observación a: {obs.workerName}</h4>
                                                <p className="text-sm text-muted-foreground">Obra: <span className="font-medium">{obs.obra}</span></p>
                                                <p className="text-xs text-muted-foreground mt-1">Registrado por: {obs.observerName} el {formatDate(obs.observationDate)}</p>
                                            </div>
                                            <div className="flex items-center gap-4 flex-shrink-0">
                                                {getRiskBadge(obs.riskLevel)}
                                                <ArrowRight className="h-5 w-5 text-muted-foreground"/>
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : (
                             <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full p-12">
                                <Inbox className="h-16 w-16 mb-4"/>
                                <h3 className="text-xl font-semibold">No hay observaciones</h3>
                                <p className="mt-2">Aún no se ha registrado ninguna observación de conducta.</p>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
