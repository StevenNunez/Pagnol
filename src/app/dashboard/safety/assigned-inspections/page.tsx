
"use client";

import React, { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, Inbox, ArrowRight } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { type SafetyInspection, type User } from "@/modules/core/lib/data";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'N/A';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    return jsDate.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function AssignedInspectionsPage() {
    const { safetyInspections, users } = useAppState();
    const { user } = useAuth();

    const myAssignedInspections = useMemo(() => {
        if (!user || !safetyInspections) return [];
        return safetyInspections
            .filter((c: SafetyInspection) => c.assignedTo === user.id)
            .sort((a: SafetyInspection, b: SafetyInspection) => b.date.getTime() - a.date.getTime());
    }, [safetyInspections, user]);
    
    const userMap = useMemo(() => new Map<string, string>((users || []).map((u: User) => [u.id, u.name])), [users]);

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'open': return <Badge variant="secondary" className="bg-blue-500 text-white">Abierta</Badge>;
            case 'in-progress': return <Badge variant="secondary" className="bg-yellow-500 dark:bg-yellow-600 text-white">En Progreso</Badge>;
            case 'completed': return <Badge variant="default" className="bg-green-600 dark:bg-green-700 text-white">Completada</Badge>;
            default: return <Badge variant="outline">{status}</Badge>;
        }
    };
    
    const getRiskBadge = (level: string) => {
        switch (level) {
            case 'leve': return <Badge variant="secondary">Leve</Badge>;
            case 'grave': return <Badge variant="destructive">Grave</Badge>;
            case 'fatal': return <Badge variant="destructive" className="bg-black text-white">Fatal</Badge>;
            default: return null;
        }
    }

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Mis Inspecciones de Seguridad Asignadas"
                description="Aquí encontrarás las tareas de seguridad que debes resolver."
            />

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ShieldCheck /> Tareas Pendientes de Seguridad</CardTitle>
                    <CardDescription>
                        Selecciona una inspección para ver los detalles y registrar la solución.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="h-[calc(80vh-12rem)] border rounded-md">
                        {myAssignedInspections.length > 0 ? (
                            <div className="space-y-3 p-4">
                                {myAssignedInspections.map((inspection: SafetyInspection) => (
                                    <Link 
                                        key={inspection.id} 
                                        href={`/dashboard/safety/assigned-inspections/${inspection.id}`}
                                        className="p-4 border rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 hover:bg-muted/50 transition-colors cursor-pointer"
                                    >
                                        <div className="flex-grow">
                                            <p className="font-semibold text-primary">{inspection.area} - {inspection.location}</p>
                                            <p className="text-sm font-medium text-foreground truncate">{inspection.description}</p>
                                            <p className="text-xs text-muted-foreground mt-1">Asignado por: {userMap.get(inspection.inspectorId) || 'Desconocido'}</p>
                                            <p className="text-xs text-muted-foreground">Fecha: {formatDate(inspection.date)}</p>
                                        </div>
                                        <div className="flex items-center gap-4 flex-shrink-0">
                                            {getRiskBadge(inspection.riskLevel)}
                                            {getStatusBadge(inspection.status)}
                                            <ArrowRight className="h-5 w-5 text-muted-foreground"/>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-full p-12">
                                <Inbox className="h-16 w-16 mb-4"/>
                                <h3 className="text-xl font-semibold">¡Todo en orden!</h3>
                                <p className="mt-2">No tienes inspecciones de seguridad pendientes en este momento.</p>
                            </div>
                        )}
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
}
