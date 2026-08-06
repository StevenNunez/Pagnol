
"use client";

import React, { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import { useAppState } from "@/modules/core/contexts/app-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList, Search, Users, Target, FileUp, ListChecks, ShieldAlert, BookOpen } from "lucide-react";
import { LoadingState } from "@/components/loading-state";
import Link from "next/link";

export default function SafetyDashboardPage() {
    const { assignedChecklists, safetyInspections, dailyTalks, behaviorObservations, checklistTemplates, isLoading } = useAppState();

    const stats = useMemo(() => {
        const checklistsPendientes = assignedChecklists?.filter(c => c.status === 'assigned').length ?? 0;
        const checklistsCompletados = assignedChecklists?.filter(c => c.status === 'completed' || c.status === 'approved').length ?? 0;

        const inspPendientes = safetyInspections?.filter(i => i.status === 'open' || i.status === 'in-progress').length ?? 0;
        const inspCompletadas = safetyInspections?.filter(i => i.status === 'completed' || i.status === 'approved').length ?? 0;

        const totalCharlas = dailyTalks?.length ?? 0;
        const totalObservaciones = behaviorObservations?.length ?? 0;
        const totalPlantillas = checklistTemplates?.length ?? 0;

        return { checklistsPendientes, checklistsCompletados, inspPendientes, inspCompletadas, totalCharlas, totalObservaciones, totalPlantillas };
    }, [assignedChecklists, safetyInspections, dailyTalks, behaviorObservations, checklistTemplates]);

    if (isLoading) {
        return <LoadingState fullHeight />;
    }

    const cards = [
        {
            title: "Checklists Pendientes",
            value: stats.checklistsPendientes,
            sub: `${stats.checklistsCompletados} completados`,
            icon: ClipboardList,
            href: "/dashboard/safety/assigned-checklists",
            color: stats.checklistsPendientes > 0 ? "text-yellow-600" : "text-green-600",
        },
        {
            title: "Inspecciones Abiertas",
            value: stats.inspPendientes,
            sub: `${stats.inspCompletadas} resueltas`,
            icon: Search,
            href: "/dashboard/safety/assigned-inspections",
            color: stats.inspPendientes > 0 ? "text-orange-600" : "text-green-600",
        },
        {
            title: "Charlas Diarias",
            value: stats.totalCharlas,
            sub: "Total registradas",
            icon: Users,
            href: "/dashboard/safety/review-daily-talks",
            color: "text-blue-600",
        },
        {
            title: "Observaciones de Conducta",
            value: stats.totalObservaciones,
            sub: "Total registradas",
            icon: Target,
            href: "/dashboard/safety/review-observations",
            color: "text-purple-600",
        },
        {
            title: "Plantillas",
            value: stats.totalPlantillas,
            sub: "Disponibles para asignar",
            icon: FileUp,
            href: "/dashboard/safety/templates",
            color: "text-slate-600",
        },
    ];

    const accesos = [
        { label: "Revisar Checklists", href: "/dashboard/safety/review-checklists", icon: ListChecks },
        { label: "Revisar Inspecciones", href: "/dashboard/safety/review-inspections", icon: ShieldAlert },
        { label: "Revisar Charlas", href: "/dashboard/safety/review-daily-talks", icon: BookOpen },
        { label: "Revisar Observaciones", href: "/dashboard/safety/review-observations", icon: Target },
    ];

    return (
        <div className="flex flex-col gap-8">
            <PageHeader
                title="Panel de Seguridad"
                description="Resumen del estado actual del módulo de Prevención de Riesgos."
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {cards.map(card => (
                    <Link key={card.href} href={card.href}>
                        <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                                <card.icon className={`h-5 w-5 ${card.color}`} />
                            </CardHeader>
                            <CardContent>
                                <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
                                <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>

            <div>
                <h2 className="text-lg font-semibold mb-4">Accesos Rápidos — Revisión</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {accesos.map(a => (
                        <Link key={a.href} href={a.href}>
                            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                                <CardContent className="flex flex-col items-center justify-center gap-2 py-6">
                                    <a.icon className="h-8 w-8 text-muted-foreground" />
                                    <span className="text-sm font-medium text-center">{a.label}</span>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
