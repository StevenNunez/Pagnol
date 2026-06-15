
"use client";

import React, { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Loader2, Inbox, ArrowRight, Users, CheckCircle } from "lucide-react";
import Link from "next/link";
import type { DailyTalk } from "@/modules/core/lib/data";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = new Date(date as any);
    return jsDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function ReviewDailyTalksPage() {
    const { dailyTalks, isLoading } = useAppState();

    const sortedTalks = useMemo(() => {
        if (!dailyTalks) return [];
        return [...dailyTalks].sort((a, b) => {
            const dateA = new Date(a.fecha as any).getTime();
            const dateB = new Date(b.fecha as any).getTime();
            return dateB - dateA;
        });
    }, [dailyTalks]);

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Revisión de Charlas Diarias"
                description="Historial de todas las charlas de seguridad registradas."
            />

            <Card>
                <CardHeader>
                    <CardTitle>Historial de Charlas</CardTitle>
                    <CardDescription>
                        Selecciona una charla para ver los detalles completos y descargar el informe en PDF.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[calc(80vh-12rem)] border rounded-md">
                        {sortedTalks.length > 0 ? (
                            <div className="space-y-3 p-4">
                                {sortedTalks.map((talk: DailyTalk) => {
                                    const firmados = talk.asistentes?.filter(a => a.signed).length ?? 0;
                                    const total = talk.asistentes?.length ?? 0;
                                    return (
                                        <Link key={talk.id} href={`/dashboard/safety/review-daily-talks/${talk.id}`}>
                                            <div className="p-4 border rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-muted/50 transition-colors cursor-pointer">
                                                <div className="flex-grow">
                                                    <h4 className="font-semibold">Charla del {formatDate(talk.fecha)}</h4>
                                                    <p className="text-sm text-muted-foreground">Obra: <span className="font-medium">{talk.obra}</span></p>
                                                    <p className="text-xs text-muted-foreground mt-1">Expositor: {talk.expositorName}</p>
                                                </div>
                                                <div className="flex items-center gap-3 flex-shrink-0">
                                                    <Badge variant="outline" className="flex items-center gap-1">
                                                        <Users className="h-3 w-3" /> {total} asistentes
                                                    </Badge>
                                                    <Badge
                                                        variant="outline"
                                                        className={firmados === total && total > 0
                                                            ? "bg-green-100 text-green-700 border-green-200"
                                                            : "bg-yellow-100 text-yellow-700 border-yellow-200"
                                                        }
                                                    >
                                                        <CheckCircle className="h-3 w-3 mr-1" /> {firmados}/{total} firmados
                                                    </Badge>
                                                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full p-12">
                                <Inbox className="h-16 w-16 mb-4" />
                                <h3 className="text-xl font-semibold">No hay charlas registradas</h3>
                                <p className="mt-2">Aún no se ha registrado ninguna charla diaria de seguridad.</p>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
