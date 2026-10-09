"use client";

import { useCallback, useMemo, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { Input } from "@/components/ui/input";
import { useAppState, useAuth } from "@/modules/core/contexts/app-provider";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ClipboardCheck, Search, ChevronRight, AlertTriangle, CheckCircle2, Lock, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authHeaders } from "@/modules/core/lib/auth-header";
import { format, formatDistanceToNow, isToday } from "date-fns";
import { es } from "date-fns/locale";
import type { Material, User } from "@/modules/core/lib/data";
import type { ReviewLine } from "@/modules/data/mutations/withdrawalReviewMutations";
import { useReviewableWithdrawals, type ReviewableWithdrawal } from "@/components/withdrawal-review/use-reviewable-withdrawals";
import { ReviewDialog } from "@/components/withdrawal-review/review-dialog";
import { ObservationsList } from "@/components/withdrawal-review/observations-list";
import { downloadWithdrawalReport } from "@/components/withdrawal-review/export-report";

type Tab = "pending" | "reviewed" | "observations";
const REVIEWED_LIMIT = 50;

/**
 * Bandeja del supervisor para los retiros que el pañol entregó en el acto
 * (empresa en modo "revisión posterior"). Pensada para el celular: el
 * supervisor revisa entre una tarea y otra, no sentado en un escritorio.
 */
export default function RevisarRetirosPage() {
    const { users, materials, reviewWithdrawal, justifyWithdrawalObservation, can, currentTenant } = useAppState();
    const { getTenantId } = useAuth();
    const { toast } = useToast();
    const { canReview, all, pending, reviewed, observations, openObservations } = useReviewableWithdrawals();
    const canResolve = can("material_requests:resolve_observations");
    const [exporting, setExporting] = useState(false);

    const [tab, setTab] = useState<Tab>("pending");
    const [search, setSearch] = useState("");
    const [openId, setOpenId] = useState<string | null>(null);

    const usersMap = useMemo(() => new Map(((users || []) as User[]).map(u => [u.id, u])), [users]);
    const materialMap = useMemo(() => new Map(((materials || []) as Material[]).map(m => [m.id, m])), [materials]);
    const workerOf = useCallback(
        (w: ReviewableWithdrawal) => usersMap.get(w.req.supervisorId)?.name || w.req.userName || "Trabajador",
        [usersMap]
    );

    const filteredObservations = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return observations;
        return observations.filter(o =>
            (usersMap.get(o.req.supervisorId)?.name || o.req.userName || "").toLowerCase().includes(q)
            || (o.req.internalCode || "").toLowerCase().includes(q)
            || o.fact.materialName.toLowerCase().includes(q)
        );
    }, [observations, search, usersMap]);

    const list = useMemo(() => {
        if (tab === "observations") return [];
        const base = tab === "pending" ? pending : reviewed.slice(0, REVIEWED_LIMIT);
        const q = search.trim().toLowerCase();
        if (!q) return base;
        return base.filter(w =>
            workerOf(w).toLowerCase().includes(q)
            || (w.req.internalCode || "").toLowerCase().includes(q)
            || (w.req.items || []).some(it => (materialMap.get(it.materialId)?.name || "").toLowerCase().includes(q))
        );
    }, [tab, pending, reviewed, search, workerOf, materialMap]);

    // Se busca en `all` vía pending/reviewed para que, al llegar la revisión
    // por Realtime, el diálogo muestre el estado nuevo sin cerrarse.
    const openItem = useMemo(
        () => [...pending, ...reviewed].find(w => w.req.id === openId) || null,
        [openId, pending, reviewed]
    );

    const submit = async (lines: ReviewLine[]) => {
        if (!openItem) return;
        try {
            await reviewWithdrawal({ requestId: openItem.req.id, lines });
            const no = lines.filter(l => l.decision === "unauthorized").length;
            if (no > 0) {
                // Administración se entera en el momento de lo que no correspondía.
                const adminIds = ((users || []) as User[]).filter(u => u.role === "administrador").map(u => u.id);
                if (adminIds.length > 0) {
                    fetch("/api/push/send", {
                        method: "POST",
                        headers: await authHeaders(),
                        body: JSON.stringify({
                            tenantId: getTenantId(),
                            targetUserIds: adminIds,
                            payload: {
                                title: "Retiro con ítems no autorizados",
                                body: `${workerOf(openItem)}: ${lines.filter(l => l.decision === "unauthorized").map(l => l.materialName).join(", ")}.`,
                                url: "/dashboard/pagnol/revisar-retiros",
                                tag: `withdrawal-unauthorized-${openItem.req.id}`,
                            },
                        }),
                    }).catch(() => {});
                }
            }
            toast({
                variant: "success",
                title: "Revisión guardada",
                description: no === 0 ? "Todo el retiro corresponde." : `${no} ítem${no > 1 ? "s" : ""} quedó como no autorizado.`,
            });
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo guardar", description: err?.message || "Intenta nuevamente." });
            throw err;
        }
    };

    const justify = async (reviewId: string, note: string) => {
        try {
            await justifyWithdrawalObservation({ reviewId, note });
            toast({ variant: "success", title: "Observación cerrada", description: "Quedó registrada la justificación." });
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo cerrar", description: err?.message || "Intenta nuevamente." });
            throw err;
        }
    };

    const exportExcel = async () => {
        setExporting(true);
        try {
            await downloadWithdrawalReport({ withdrawals: all, observations, workerName: workerOf, materialMap, companyName: currentTenant?.name });
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo generar el Excel", description: err?.message || "Intenta nuevamente." });
        } finally {
            setExporting(false);
        }
    };

    if (!canReview) {
        return (
            <PageShell title="Revisar retiros" description="Lo que el pañol entregó a tu cuadrilla.">
                <EmptyState icon={<Lock size={24} />} title="Sin acceso" description="Tu perfil no tiene permiso para revisar retiros." />
            </PageShell>
        );
    }

    return (
        <PageShell title="Revisar retiros" description="Lo que el pañol entregó a tu cuadrilla. Confirma que corresponde o marca lo que no.">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1 bg-muted/50 border rounded-xl p-1 w-full sm:w-fit">
                    {([
                        { key: "pending", label: "Por revisar", count: pending.length },
                        { key: "reviewed", label: "Revisados", count: reviewed.length },
                        { key: "observations", label: "No autorizados", count: openObservations },
                    ] as { key: Tab; label: string; count: number }[]).map(t => (
                        <button key={t.key} type="button" onClick={() => setTab(t.key)}
                            className={cn("flex-1 sm:flex-none px-2.5 sm:px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wider sm:tracking-widest transition-all leading-tight",
                                tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                            {t.label} ({t.count})
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-72">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
                        <Input value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar trabajador, código o material…" className="h-11 rounded-xl pl-10 text-sm bg-card" />
                    </div>
                    <Button variant="outline" onClick={exportExcel} disabled={exporting || all.length === 0}
                        className="h-11 rounded-xl gap-2 shrink-0" aria-label="Descargar Excel">
                        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        <span className="hidden sm:inline">Excel</span>
                    </Button>
                </div>
            </div>

            {tab === "observations" ? (
                filteredObservations.length === 0 ? (
                    <EmptyState
                        icon={<CheckCircle2 size={24} />}
                        title={search ? "Sin resultados" : "Nada marcado como no autorizado"}
                        description={search ? `No se encontró "${search}".` : "Lo que se marque como «no corresponde» aparece aquí hasta que se devuelva o se justifique."}
                    />
                ) : (
                    <ObservationsList
                        items={filteredObservations}
                        workerName={(o) => usersMap.get(o.req.supervisorId)?.name || o.req.userName || "Trabajador"}
                        materialMap={materialMap}
                        canResolve={canResolve}
                        onJustify={justify}
                    />
                )
            ) : list.length === 0 ? (
                <EmptyState
                    icon={tab === "pending" ? <CheckCircle2 size={24} /> : <ClipboardCheck size={24} />}
                    title={search ? "Sin resultados" : tab === "pending" ? "Nada por revisar" : "Aún no hay retiros revisados"}
                    description={search
                        ? `No se encontró "${search}".`
                        : tab === "pending"
                            ? "Cuando el pañol entregue algo a tu cuadrilla, aparecerá aquí."
                            : "Los retiros que revises quedarán aquí."}
                />
            ) : (
                <div className="space-y-3">
                    {list.map(w => {
                        const created = new Date(w.req.createdAt as any);
                        const lineCount = new Set((w.req.items || []).map(i => i.materialId)).size;
                        const names = [...new Set((w.req.items || []).map(i => i.materialId))]
                            .slice(0, 3).map(id => materialMap.get(id)?.name || "Ítem");
                        return (
                            <button key={w.req.id} type="button" onClick={() => setOpenId(w.req.id)}
                                className="w-full text-left bg-card rounded-[1.5rem] border shadow-sm hover:shadow-md transition-all p-4 sm:p-5 flex items-center gap-4">
                                <div className="flex-1 min-w-0 space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-bold text-base leading-tight break-words">{workerOf(w)}</p>
                                        {w.summary.state === "partial" && (
                                            <span className="badge-warning text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md">A medias</span>
                                        )}
                                        {w.summary.state === "reviewed" && (w.summary.unauthorizedLines > 0
                                            ? <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-destructive/10 text-destructive flex items-center gap-1"><AlertTriangle size={10} /> {w.summary.unauthorizedLines} no corresponde{w.summary.unauthorizedLines > 1 ? "n" : ""}</span>
                                            : <span className="badge-success text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md">Todo corresponde</span>)}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {isToday(created) ? `Hoy ${format(created, "HH:mm")}` : format(created, "d MMM HH:mm", { locale: es })}
                                        {" · "}{formatDistanceToNow(created, { addSuffix: true, locale: es })}
                                        {w.req.internalCode ? ` · ${w.req.internalCode}` : ""}
                                    </p>
                                    <p className="text-sm text-foreground/80 break-words">
                                        <span className="font-bold">{lineCount} ítem{lineCount !== 1 ? "s" : ""}:</span>{" "}
                                        {names.join(", ")}{lineCount > 3 ? ` y ${lineCount - 3} más` : ""}
                                    </p>
                                </div>
                                <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                            </button>
                        );
                    })}
                    {tab === "reviewed" && reviewed.length > REVIEWED_LIMIT && !search && (
                        <p className="text-[11px] text-muted-foreground text-center">Mostrando los {REVIEWED_LIMIT} más recientes.</p>
                    )}
                </div>
            )}

            <ReviewDialog
                key={openId ?? "none"}
                item={openItem}
                workerName={openItem ? workerOf(openItem) : ""}
                materialMap={materialMap}
                onClose={() => setOpenId(null)}
                onSubmit={submit}
            />
        </PageShell>
    );
}
