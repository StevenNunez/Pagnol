"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, X, Loader2, Package } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { Material } from "@/modules/core/lib/data";
import type { ReviewLine } from "@/modules/data/mutations/withdrawalReviewMutations";
import { useIsPhone } from "@/components/supervisor-requests/material-picker-shell";
import type { ReviewableWithdrawal } from "./use-reviewable-withdrawals";

const QUICK_REASONS = ["No es para su tarea del día", "Cantidad excesiva", "No está autorizado a usarlo"];

interface Draft { decision: "authorized" | "unauthorized"; reason: string }

/**
 * Revisión de un retiro, línea por línea. Cada línea pendiente parte marcada
 * como "corresponde": el supervisor sólo toca las que NO corresponden y
 * confirma. Es lo habitual (casi todo está bien) y así revisar 15 ítems son dos
 * toques, no quince.
 *
 * Lo ya revisado se muestra pero no se puede cambiar: la revisión es un hecho.
 */
export function ReviewDialog({
    item, workerName, materialMap, onClose, onSubmit,
}: {
    item: ReviewableWithdrawal | null;
    workerName: string;
    materialMap: Map<string, Material>;
    onClose: () => void;
    onSubmit: (lines: ReviewLine[]) => Promise<void>;
}) {
    const isPhone = useIsPhone();
    const [drafts, setDrafts] = useState<Record<string, Draft>>({});
    const [saving, setSaving] = useState(false);

    // Una fila por material (un material repetido en el JSON suma cantidades).
    const lines = useMemo(() => {
        if (!item) return [];
        const acc = new Map<string, number>();
        for (const it of item.req.items || []) acc.set(it.materialId, (acc.get(it.materialId) || 0) + (Number(it.quantity) || 0));
        return [...acc.entries()].map(([materialId, quantity]) => ({ materialId, quantity, material: materialMap.get(materialId) }));
    }, [item, materialMap]);

    const factByMaterial = useMemo(
        () => new Map((item?.facts || []).filter(f => f.materialId).map(f => [f.materialId as string, f])),
        [item]
    );
    const openLines = lines.filter(l => !factByMaterial.has(l.materialId));
    const draftOf = (id: string): Draft => drafts[id] ?? { decision: "authorized", reason: "" };
    const setDraft = (id: string, patch: Partial<Draft>) => setDrafts(prev => ({ ...prev, [id]: { ...draftOf(id), ...patch } }));

    const rejected = openLines.filter(l => draftOf(l.materialId).decision === "unauthorized");
    const missingReason = rejected.some(l => !draftOf(l.materialId).reason.trim());

    const close = () => { if (!saving) { setDrafts({}); onClose(); } };

    const submit = async () => {
        if (!item || openLines.length === 0 || missingReason) return;
        setSaving(true);
        try {
            await onSubmit(openLines.map(l => {
                const d = draftOf(l.materialId);
                return {
                    materialId: l.materialId,
                    materialName: l.material?.name || "Ítem",
                    quantity: l.quantity || 1,
                    decision: d.decision,
                    reason: d.decision === "unauthorized" ? d.reason.trim() : null,
                };
            }));
            setDrafts({});
            onClose();
        } catch {
            // El error ya se mostró (toast de la página); el diálogo queda
            // abierto con lo marcado para reintentar.
        } finally {
            setSaving(false);
        }
    };

    const when = item ? format(new Date(item.req.createdAt as any), "EEEE d 'de' MMMM, HH:mm", { locale: es }) : "";

    return (
        <Dialog open={!!item} onOpenChange={(o) => { if (!o) close(); }}>
            <DialogContent
                hideClose
                aria-describedby={undefined}
                className={cn(
                    "p-0 gap-0 flex flex-col",
                    isPhone
                        ? "inset-0 left-0 top-0 translate-x-0 translate-y-0 max-w-none w-full h-[100dvh] rounded-none border-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
                        : "max-w-xl max-h-[90vh] rounded-[1.5rem]",
                )}
            >
                {/* Encabezado */}
                <div className="flex items-start justify-between gap-3 p-5 border-b shrink-0">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Revisar retiro</p>
                        <DialogTitle className="text-lg font-bold leading-tight mt-0.5 break-words">{workerName}</DialogTitle>
                        <p className="text-xs text-muted-foreground mt-1 first-letter:uppercase">
                            {when}{item?.req.internalCode ? ` · ${item.req.internalCode}` : ""}
                        </p>
                        {(item?.req.contractName || item?.req.area) && (
                            <p className="text-xs text-muted-foreground break-words">
                                {[item?.req.contractName, item?.req.area].filter(Boolean).join(" · ")}
                            </p>
                        )}
                    </div>
                    <button type="button" onClick={close} aria-label="Cerrar"
                        className="p-2 -mr-2 rounded-xl text-muted-foreground hover:text-foreground shrink-0">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Líneas */}
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2">
                    {lines.map(l => {
                        const fact = factByMaterial.get(l.materialId);
                        const d = draftOf(l.materialId);
                        const decision = fact ? fact.decision : d.decision;
                        const isNo = decision === "unauthorized";
                        return (
                            <div key={l.materialId} className={cn(
                                "rounded-xl border p-3 space-y-2.5 transition-colors",
                                isNo ? "border-destructive/40 bg-destructive/5" : "bg-card",
                                fact && "opacity-80",
                            )}>
                                <div className="flex items-start gap-3">
                                    <Package className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold leading-snug break-words">{l.material?.name || fact?.materialName || "Ítem"}</p>
                                        <p className="text-[11px] text-muted-foreground mt-0.5">
                                            <span className="font-bold text-foreground">{l.quantity} {l.material?.unit || "ud"}</span>
                                            {l.material?.internalCode && <span className="font-mono"> · {l.material.internalCode}</span>}
                                            {l.material?.class && <span> · Clase {l.material.class}</span>}
                                        </p>
                                    </div>
                                </div>

                                {fact ? (
                                    <p className={cn("text-[11px] font-bold", isNo ? "text-destructive" : "text-success")}>
                                        {isNo ? "No corresponde" : "Corresponde"} · revisado por {fact.reviewerName}
                                        {fact.reason && <span className="font-medium text-muted-foreground"> — {fact.reason}</span>}
                                    </p>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button type="button" disabled={saving}
                                                onClick={() => setDraft(l.materialId, { decision: "authorized" })}
                                                aria-pressed={!isNo}
                                                className={cn("h-10 rounded-lg border-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                                                    !isNo ? "border-success bg-success-subtle text-success-subtle-foreground" : "border-border text-muted-foreground")}>
                                                <Check className="h-4 w-4" /> Corresponde
                                            </button>
                                            <button type="button" disabled={saving}
                                                onClick={() => setDraft(l.materialId, { decision: "unauthorized" })}
                                                aria-pressed={isNo}
                                                className={cn("h-10 rounded-lg border-2 text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                                                    isNo ? "border-destructive bg-destructive/10 text-destructive" : "border-border text-muted-foreground")}>
                                                <X className="h-4 w-4" /> No corresponde
                                            </button>
                                        </div>
                                        {isNo && (
                                            <div className="space-y-2">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {QUICK_REASONS.map(r => (
                                                        <button key={r} type="button" disabled={saving}
                                                            onClick={() => setDraft(l.materialId, { reason: r })}
                                                            className={cn("px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold",
                                                                d.reason === r ? "border-destructive bg-destructive/10 text-destructive" : "bg-card text-muted-foreground")}>
                                                            {r}
                                                        </button>
                                                    ))}
                                                </div>
                                                <Input
                                                    value={d.reason}
                                                    onChange={e => setDraft(l.materialId, { reason: e.target.value })}
                                                    placeholder="¿Por qué no corresponde?"
                                                    maxLength={300}
                                                    disabled={saving}
                                                    className="h-10 rounded-lg text-sm"
                                                />
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Pie */}
                <div className="p-4 border-t shrink-0 space-y-2 bg-card">
                    {openLines.length === 0 ? (
                        <Button variant="outline" className="w-full h-12 rounded-xl" onClick={close}>Cerrar</Button>
                    ) : (
                        <>
                            {missingReason && (
                                <p className="text-[11px] font-bold text-destructive text-center">Indica el motivo de lo que no corresponde.</p>
                            )}
                            <Button onClick={submit} disabled={saving || missingReason}
                                className={cn("w-full h-12 rounded-xl text-sm font-black uppercase tracking-widest gap-2",
                                    rejected.length > 0 && "bg-destructive hover:bg-destructive/90 text-destructive-foreground")}>
                                {saving ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : rejected.length === 0
                                        ? <><Check className="h-4 w-4" /> Todo corresponde ({openLines.length})</>
                                        : <>Confirmar · {rejected.length} no corresponde{rejected.length > 1 ? "n" : ""}</>}
                            </Button>
                            <p className="text-[10px] text-muted-foreground text-center">La revisión queda registrada y no se puede cambiar.</p>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
