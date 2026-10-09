"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, FileCheck2, Loader2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { Material } from "@/modules/core/lib/data";
import type { WithdrawalObservation } from "./use-reviewable-withdrawals";

const STATUS_META = {
    open: { label: "Abierta", cls: "bg-destructive/10 text-destructive", icon: AlertTriangle },
    returned: { label: "Devuelta", cls: "badge-success", icon: CheckCircle2 },
    justified: { label: "Justificada", cls: "badge-info", icon: FileCheck2 },
} as const;

/**
 * Lo que el supervisor marcó "no corresponde" y en qué quedó: abierto,
 * devuelto en el pañol (se detecta solo) o cerrado por administración con una
 * justificación.
 */
export function ObservationsList({
    items, workerName, materialMap, canResolve, onJustify,
}: {
    items: WithdrawalObservation[];
    workerName: (o: WithdrawalObservation) => string;
    materialMap: Map<string, Material>;
    canResolve: boolean;
    onJustify: (reviewId: string, note: string) => Promise<void>;
}) {
    const [target, setTarget] = useState<WithdrawalObservation | null>(null);
    const [note, setNote] = useState("");
    const [saving, setSaving] = useState(false);

    const close = () => { if (!saving) { setTarget(null); setNote(""); } };
    const submit = async () => {
        if (!target || !note.trim()) return;
        setSaving(true);
        try {
            await onJustify(target.fact.id, note.trim());
            setTarget(null);
            setNote("");
        } catch {
            // El toast con el motivo lo muestra la página; queda abierto para reintentar.
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="space-y-3">
                {items.map(o => {
                    const meta = STATUS_META[o.state.status];
                    const created = new Date(o.req.createdAt as any);
                    const unit = (o.fact.materialId && materialMap.get(o.fact.materialId)?.unit) || "ud";
                    return (
                        <div key={o.fact.id} className={cn(
                            "bg-card rounded-[1.5rem] border shadow-sm p-4 sm:p-5 space-y-3",
                            o.state.status === "open" && "border-destructive/30",
                        )}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="font-bold leading-snug break-words">{o.fact.materialName}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        <span className="font-bold text-foreground">{o.fact.quantity} {unit}</span>
                                        {" · "}{workerName(o)}
                                    </p>
                                </div>
                                <span className={cn("shrink-0 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md flex items-center gap-1", meta.cls)}>
                                    <meta.icon size={10} /> {meta.label}
                                </span>
                            </div>

                            <div className="text-xs space-y-1">
                                <p className="text-muted-foreground">
                                    Retirado {format(created, "d MMM HH:mm", { locale: es })}
                                    {o.req.internalCode ? ` · ${o.req.internalCode}` : ""}
                                    {o.req.contractName ? ` · ${o.req.contractName}` : ""}
                                </p>
                                <p>
                                    <span className="font-semibold">Motivo:</span> {o.fact.reason}
                                    <span className="text-muted-foreground"> — {o.fact.reviewerName}</span>
                                </p>
                                {o.state.status === "open" && o.state.returnedQty > 0 && (
                                    <p className="font-semibold text-warning">Devolvió {o.state.returnedQty} de {o.fact.quantity}.</p>
                                )}
                                {o.state.status === "returned" && o.state.closingReturn && (
                                    <p className="text-success font-semibold">
                                        Devuelto en el pañol
                                        {o.state.closingReturn.internalCode ? ` (${o.state.closingReturn.internalCode})` : ""}
                                        {" el "}{format(o.state.closingReturn.at, "d MMM HH:mm", { locale: es })}
                                    </p>
                                )}
                                {o.resolution && (
                                    <p>
                                        <span className="font-semibold">Justificación:</span> {o.resolution.note}
                                        <span className="text-muted-foreground"> — {o.resolution.resolvedByName}, {format(o.resolution.createdAt, "d MMM", { locale: es })}</span>
                                    </p>
                                )}
                            </div>

                            {o.state.status === "open" && (
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
                                    <p className="text-[11px] text-muted-foreground">
                                        Abierta {formatDistanceToNow(created, { locale: es })}. Se cierra sola cuando lo devuelva en el pañol.
                                    </p>
                                    {canResolve && (
                                        <Button variant="outline" size="sm" className="rounded-xl h-10 shrink-0" onClick={() => setTarget(o)}>
                                            Cerrar con justificación
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <Dialog open={!!target} onOpenChange={(o) => { if (!o) close(); }}>
                <DialogContent className="max-w-md rounded-[1.5rem]">
                    <DialogHeader>
                        <DialogTitle>Cerrar con justificación</DialogTitle>
                        <DialogDescription>
                            {target ? `${target.fact.materialName} · ${target.fact.quantity} · ${workerName(target)}` : ""}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                        <Textarea
                            value={note}
                            onChange={e => setNote(e.target.value)}
                            placeholder="Ej.: consumible ya utilizado en la faena; se conversó con el trabajador."
                            maxLength={500}
                            rows={4}
                            disabled={saving}
                            className="rounded-xl"
                        />
                        <p className="text-[11px] text-muted-foreground">Queda registrada con tu nombre y no se puede cambiar.</p>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={close} disabled={saving}>Cancelar</Button>
                        <Button onClick={submit} disabled={saving || !note.trim()} className="rounded-xl gap-2">
                            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Cerrar observación
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
