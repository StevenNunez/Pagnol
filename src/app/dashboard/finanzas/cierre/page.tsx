"use client";

// Cierre de período (Dominio Financiero F4.1 — RFC-002-F4-Plan). Congela el
// pasado: un mes cerrado deja de aceptar hechos con esa fecha contable, y el
// margen ya reportado no puede cambiar por un devengo tardío.
//
// El soft-lock lo aplica un trigger en la base, no esta página: los emisores y
// los crons son rechazados aunque nadie abra este panel.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { LoadingState } from "@/components/loading-state";
import { useAuth, useAppState } from "@/modules/core/contexts/app-provider";
import {
    fetchPeriodEvents, closedMonths as deriveClosed, precheckPeriod, toPeriodMonth,
} from "@/modules/data/mutations/periodMutations";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/modules/core/hooks/use-toast";
import type { FinancePeriodEvent, FinancePeriodWarning } from "@/modules/core/lib/data";
import {
    ArrowLeft, Lock, LockOpen, ShieldAlert, AlertTriangle, Info, Loader2, History, CalendarCheck,
} from "lucide-react";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function monthLabel(period: string) {
    const [y, m] = period.split("-").map(Number);
    return `${MONTHS[m - 1]} ${y}`;
}

/** Últimos N meses hasta el actual, del más reciente al más antiguo. */
function recentMonths(n = 18): string[] {
    const out: string[] = [];
    const now = new Date();
    for (let i = 0; i < n; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
    }
    return out;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function CierrePage() {
    const router = useRouter();
    const { can, getTenantId } = useAuth();
    const { closePeriod, reopenPeriod } = useAppState();
    const { toast } = useToast();

    const canView = can("module_finance:view");
    const canManage = can("finance:manage");

    const [events, setEvents] = useState<FinancePeriodEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Diálogo de cierre: primero el chequeo previo, después la confirmación.
    const [target, setTarget] = useState<{ month: string; mode: "close" | "reopen" } | null>(null);
    const [warnings, setWarnings] = useState<FinancePeriodWarning[] | null>(null);
    const [checking, setChecking] = useState(false);
    const [reason, setReason] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const tenantId = getTenantId();
            if (!tenantId) return;
            setEvents(await fetchPeriodEvents(tenantId));
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo cargar el estado de los períodos", description: e?.message || "Error desconocido." });
        } finally {
            setLoading(false);
        }
    }, [getTenantId, toast]);

    useEffect(() => { if (canView) load(); }, [canView, load]);

    const closed = useMemo(() => deriveClosed(events), [events]);
    const months = useMemo(() => recentMonths(), []);

    const openDialog = async (month: string, mode: "close" | "reopen") => {
        setTarget({ month, mode });
        setReason("");
        setWarnings(null);
        if (mode !== "close") return;
        // Cerrar sobre datos incompletos congela el mes sin esos costos: se
        // muestra la foto ANTES de confirmar (no bloquea, informa).
        setChecking(true);
        try {
            setWarnings(await precheckPeriod(month, getTenantId()!));
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo revisar el período", description: e?.message || "Error desconocido." });
            setWarnings([]);
        } finally {
            setChecking(false);
        }
    };

    const confirm = async () => {
        if (!target) return;
        setSaving(true);
        try {
            if (target.mode === "close") {
                await closePeriod({ month: target.month, reason: reason.trim() || undefined });
                toast({ title: `${monthLabel(target.month)} cerrado`, description: "El ledger ya no acepta hechos con fecha contable en ese mes." });
            } else {
                await reopenPeriod({ month: target.month, reason: reason.trim() });
                toast({ title: `${monthLabel(target.month)} reabierto`, description: "Los materializadores volverán a emitir lo que quedó bloqueado en su próxima corrida." });
            }
            setTarget(null);
            await load();
        } catch (e: any) {
            toast({ variant: "destructive", title: "No se pudo completar la operación", description: e?.message || "Error desconocido." });
        } finally {
            setSaving(false);
        }
    };

    if (!canView) {
        return (
            <PageShell title="Cierre de Período" description="Congelar meses del ledger financiero">
                <EmptyState icon={<ShieldAlert className="h-6 w-6" />} title="Acceso restringido"
                    description="El cierre de período es información financiera sensible. Pide a un administrador el permiso 'Acceder a Finanzas'." />
            </PageShell>
        );
    }

    const blocking = (warnings || []).filter((w) => w.severity === "warning");

    return (
        <PageShell
            title="Cierre de Período"
            description="Un mes cerrado deja de aceptar hechos con esa fecha contable: el margen ya reportado no cambia por un devengo tardío. Reabrir queda registrado con motivo."
            toolbar={
                <Button variant="ghost" className="rounded-xl" onClick={() => router.push("/dashboard/finanzas")}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Resultado por Contrato
                </Button>
            }
        >
            <Card className="rounded-[1.5rem]">
                <CardContent className="p-0">
                    {loading ? (
                        <LoadingState label="Revisando el estado de los períodos…" />
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Período</TableHead>
                                        <TableHead>Estado</TableHead>
                                        <TableHead>Cerrado por</TableHead>
                                        <TableHead className="text-right w-40">Acción</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {months.map((month) => {
                                        const ev = closed.get(month);
                                        const isClosed = !!ev;
                                        return (
                                            <TableRow key={month}>
                                                <TableCell className="font-medium capitalize">{monthLabel(month)}</TableCell>
                                                <TableCell>
                                                    {isClosed
                                                        ? <Badge variant="secondary" className="rounded-xl"><Lock className="mr-1 h-3 w-3" />Cerrado</Badge>
                                                        : <Badge className="badge-success rounded-xl"><LockOpen className="mr-1 h-3 w-3" />Abierto</Badge>}
                                                </TableCell>
                                                <TableCell className="text-sm text-muted-foreground">
                                                    {isClosed
                                                        ? <>{ev.createdByName || "—"} · {new Date(ev.createdAt as any).toLocaleDateString("es-CL")}</>
                                                        : "—"}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {canManage && (
                                                        <Button variant={isClosed ? "ghost" : "outline"} size="sm" className="rounded-xl"
                                                            onClick={() => openDialog(month, isClosed ? "reopen" : "close")}>
                                                            {isClosed ? <><LockOpen className="mr-2 h-3.5 w-3.5" />Reabrir</> : <><Lock className="mr-2 h-3.5 w-3.5" />Cerrar</>}
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Historial: cerrar → reabrir → cerrar queda completo */}
            {events.length > 0 && (
                <Card className="rounded-[1.5rem]">
                    <CardContent className="p-6 space-y-3">
                        <MicroLabel>Historial de cierres</MicroLabel>
                        {events.slice(0, 12).map((e) => (
                            <div key={e.id} className="flex items-start justify-between gap-3 border rounded-xl p-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium capitalize">
                                        {e.action === "close" ? "Cerró" : "Reabrió"} {monthLabel(e.periodMonth)}
                                    </p>
                                    {e.reason && <p className="text-xs text-muted-foreground">{e.reason}</p>}
                                </div>
                                <div className="text-right shrink-0 text-[10px] text-muted-foreground">
                                    <div>{new Date(e.createdAt as any).toLocaleDateString("es-CL")}</div>
                                    <div>{e.createdByName}</div>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            )}

            <p className="text-xs text-muted-foreground">
                Los materializadores (mano de obra, ciclos de arriendo) reintentan en cada corrida: lo que
                queda bloqueado por un período cerrado se reporta como <span className="font-mono">blocked</span> y
                se emite solo si el mes se reabre. Nada se pierde en silencio.
            </p>

            {/* Confirmación con chequeo previo */}
            <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="capitalize">
                            {target?.mode === "close" ? "Cerrar" : "Reabrir"} {target && monthLabel(target.month)}
                        </DialogTitle>
                        <DialogDescription>
                            {target?.mode === "close"
                                ? "A partir de aquí el ledger rechaza hechos con fecha contable en ese mes. Se puede reabrir después, y queda registrado."
                                : "Reabrir deshace la garantía de que ese mes ya no cambia. El motivo queda en el historial."}
                        </DialogDescription>
                    </DialogHeader>

                    {target?.mode === "close" && (
                        <div className="space-y-3">
                            <MicroLabel>Revisión previa</MicroLabel>
                            {checking ? (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Buscando costos que quedarían fuera…
                                </div>
                            ) : (warnings || []).length === 0 ? (
                                <div className="flex items-center gap-2 text-sm rounded-xl border p-3">
                                    <CalendarCheck className="h-4 w-4 text-success" />
                                    Sin observaciones: no se detectan costos pendientes de registrar en el período.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {(warnings || []).map((w) => (
                                        <div key={w.kind} className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${w.severity === "warning" ? "border-warning/40" : ""}`}>
                                            {w.severity === "warning"
                                                ? <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-warning" />
                                                : <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />}
                                            <div>
                                                <p>{w.detail}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {w.count} {w.count === 1 ? "caso" : "casos"}
                                                    {w.amount ? ` · ${CLP.format(w.amount)}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                    {blocking.length > 0 && (
                                        <p className="text-xs text-muted-foreground">
                                            Puedes cerrar igual, pero esos costos quedarán fuera del mes de forma permanente
                                            (salvo que lo reabras).
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <MicroLabel>{target?.mode === "close" ? "Motivo (opcional)" : "Motivo (obligatorio)"}</MicroLabel>
                        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-xl"
                            placeholder={target?.mode === "close"
                                ? "Ej: cierre contable mensual enviado al contador"
                                : "Ej: llegó una factura de proveedor con fecha del período"} />
                    </div>

                    <DialogFooter>
                        <Button variant="outline" className="rounded-xl" onClick={() => setTarget(null)}>Cancelar</Button>
                        <Button className="rounded-xl" onClick={confirm}
                            disabled={saving || checking || (target?.mode === "reopen" && !reason.trim())}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : target?.mode === "close" ? <Lock className="mr-2 h-4 w-4" /> : <LockOpen className="mr-2 h-4 w-4" />}
                            {target?.mode === "close" ? "Cerrar período" : "Reabrir período"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </PageShell>
    );
}
