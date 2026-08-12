"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardList, ArrowRight, ListChecks, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { AssignedSafetyTask, User } from "@/modules/core/lib/data";

const formatDate = (date: Date | string | undefined | null) => {
    if (!date) return 'Sin fecha';
    const jsDate = date instanceof Date ? date : new Date(date as any);
    if (isNaN(jsDate.getTime())) return 'Sin fecha';
    return format(jsDate, "d 'de' MMMM, yyyy", { locale: es });
};

const STATUS_BADGE: Record<AssignedSafetyTask['status'], { label: string; className: string }> = {
    assigned: { label: 'Pendiente', className: 'badge-warning' },
    completed: { label: 'Enviado a revisión', className: 'badge-info' },
    approved: { label: 'Aprobado', className: 'badge-success' },
    rejected: { label: 'Rechazado', className: 'bg-destructive/10 text-destructive' },
};

function ChecklistRow({ checklist, href }: { checklist: AssignedSafetyTask; href: string }) {
    const badge = STATUS_BADGE[checklist.status] ?? { label: checklist.status, className: 'bg-muted text-muted-foreground' };
    return (
        <Link
            href={href}
            className="flex flex-col gap-4 rounded-[1.5rem] border bg-card p-5 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between"
        >
            <div className="min-w-0 flex-grow space-y-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    {checklist.area || 'Sin área'}
                </p>
                <p className="truncate font-bold text-foreground">{checklist.templateTitle}</p>
                <p className="text-xs text-muted-foreground">
                    Asignado por {checklist.assignerName || 'Desconocido'} · {formatDate(checklist.createdAt)}
                </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-4">
                <Badge variant="secondary" className={`rounded-xl ${badge.className}`}>{badge.label}</Badge>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
            </div>
        </Link>
    );
}

export default function AssignedChecklistsPage() {
    const { assignedChecklists, users, can } = useAppState();
    const { user } = useAuth();

    const canReview = can('safety_checklists:review');

    // Asignados a MÍ: pendientes primero, y dentro de cada grupo lo más reciente arriba.
    const misChecklists = useMemo(() => {
        if (!user) return [];
        const orden: Record<string, number> = { assigned: 0, rejected: 1, completed: 2, approved: 3 };
        return assignedChecklists
            .filter(c => c.supervisorId === user.id)
            .sort((a, b) =>
                (orden[a.status] ?? 9) - (orden[b.status] ?? 9) ||
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
    }, [assignedChecklists, user]);

    // Pendientes de OTROS. Sólo para quien revisa: la tarjeta "Checklists Pendientes"
    // del panel de Seguridad cuenta todo el tenant y enlaza aquí, así que sin esto
    // el APR vería "0" después de hacer clic en un número mayor que cero.
    const pendientesDeOtros = useMemo(() => {
        if (!canReview || !user) return [];
        return assignedChecklists
            .filter(c => c.supervisorId !== user.id && c.status === 'assigned')
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [assignedChecklists, user, canReview]);

    const userMap = useMemo(
        () => new Map<string, string>(users.map((u: User) => [u.id, u.name])),
        [users],
    );

    const pendientesPropios = misChecklists.filter(c => c.status === 'assigned').length;

    return (
        <PageShell
            title="Mis Checklists Asignados"
            description="Checklists de seguridad que debes completar y firmar."
        >
            <Card className="rounded-[2rem]">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ClipboardList className="h-5 w-5" /> Asignados a mí
                    </CardTitle>
                    <CardDescription>
                        {pendientesPropios > 0
                            ? `Tienes ${pendientesPropios} checklist${pendientesPropios === 1 ? '' : 's'} por completar.`
                            : 'Selecciona un checklist para ver su detalle.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {misChecklists.length > 0 ? (
                        <div className="space-y-3">
                            {misChecklists.map(c => (
                                <ChecklistRow
                                    key={c.id}
                                    checklist={c}
                                    href={`/dashboard/safety/assigned-checklists/${c.id}`}
                                />
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            icon={<CheckCircle2 size={24} />}
                            title="¡Todo en orden!"
                            description="No tienes checklists de seguridad asignados en este momento."
                        />
                    )}
                </CardContent>
            </Card>

            {pendientesDeOtros.length > 0 && (
                <Card className="rounded-[2rem]">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <ListChecks className="h-5 w-5" /> Pendientes del equipo
                        </CardTitle>
                        <CardDescription>
                            {pendientesDeOtros.length} checklist{pendientesDeOtros.length === 1 ? '' : 's'} asignado
                            {pendientesDeOtros.length === 1 ? '' : 's'} a otras personas, aún sin completar.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {pendientesDeOtros.map(c => (
                            <div
                                key={c.id}
                                className="flex flex-col gap-4 rounded-[1.5rem] border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0 flex-grow space-y-1">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                        {c.area || 'Sin área'}
                                    </p>
                                    <p className="truncate font-bold text-foreground">{c.templateTitle}</p>
                                    <p className="text-xs text-muted-foreground">
                                        Responsable: {userMap.get(c.supervisorId) || 'Desconocido'} · {formatDate(c.createdAt)}
                                    </p>
                                </div>
                                <Badge variant="secondary" className="rounded-xl badge-warning flex-shrink-0">Pendiente</Badge>
                            </div>
                        ))}
                        <Button asChild variant="outline" className="w-full rounded-xl">
                            <Link href="/dashboard/safety/review-checklists">Ir a revisar checklists completados</Link>
                        </Button>
                    </CardContent>
                </Card>
            )}
        </PageShell>
    );
}
