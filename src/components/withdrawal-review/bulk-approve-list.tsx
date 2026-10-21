"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CheckCheck, Loader2, Clock } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import type { Material } from "@/modules/core/lib/data";
import type { ReviewableWithdrawal } from "./use-reviewable-withdrawals";

export interface BulkLine {
    key: string;
    requestId: string;
    materialId: string;
    materialName: string;
    quantity: number;
    unit?: string;
    worker: string;
    createdAt: Date;
    overdue: boolean;
}

/** Una fila por (retiro, material) que aún no tiene decisión. */
export function pendingLines(
    items: readonly ReviewableWithdrawal[],
    workerName: (w: ReviewableWithdrawal) => string,
    materialMap: Map<string, Material>,
): BulkLine[] {
    const out: BulkLine[] = [];
    for (const w of items) {
        const decided = new Set(w.facts.map(f => f.materialId).filter(Boolean));
        const qty = new Map<string, number>();
        for (const it of w.req.items || []) qty.set(it.materialId, (qty.get(it.materialId) || 0) + (Number(it.quantity) || 0));
        for (const [materialId, quantity] of qty) {
            if (decided.has(materialId)) continue;
            const m = materialMap.get(materialId);
            out.push({
                key: `${w.req.id}:${materialId}`,
                requestId: w.req.id,
                materialId,
                materialName: m?.name || "Ítem",
                quantity: quantity || 1,
                unit: (m as any)?.unit,
                worker: workerName(w),
                createdAt: new Date(w.req.createdAt as any),
                overdue: w.due.overdue,
            });
        }
    }
    return out;
}

/**
 * Validación en bloque: lista plana de lo pendiente, con casillas. Aprobar
 * aplica SÓLO a lo marcado. Lo que no corresponde se observa abriendo el retiro
 * (pide motivo), así una aprobación masiva nunca esconde una observación.
 */
export function BulkApproveList({
    lines, onApprove,
}: {
    lines: BulkLine[];
    onApprove: (lines: BulkLine[]) => Promise<void>;
}) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);

    // Si una línea se revisa desde otro lado (Realtime), deja de contar como marcada.
    const live = useMemo(() => new Set(lines.map(l => l.key)), [lines]);
    const chosen = lines.filter(l => selected.has(l.key) && live.has(l.key));
    const allOn = lines.length > 0 && chosen.length === lines.length;

    const toggle = (key: string, on: boolean) => setSelected(prev => {
        const next = new Set(prev);
        if (on) next.add(key); else next.delete(key);
        return next;
    });

    const approve = async () => {
        if (chosen.length === 0 || saving) return;
        setSaving(true);
        try {
            await onApprove(chosen);
            setSelected(new Set());
        } catch {
            // El error ya se mostró; la selección queda para reintentar.
        } finally {
            setSaving(false);
        }
    };

    const byWorker = useMemo(() => {
        const m = new Map<string, BulkLine[]>();
        for (const l of lines) m.set(l.worker, [...(m.get(l.worker) || []), l]);
        return [...m.entries()];
    }, [lines]);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 bg-card border rounded-xl px-4 py-3 sticky top-2 z-10">
                <label className="flex items-center gap-3 text-sm font-bold cursor-pointer">
                    <Checkbox
                        checked={allOn}
                        onCheckedChange={(v) => setSelected(v ? new Set(lines.map(l => l.key)) : new Set())}
                        aria-label="Seleccionar todos"
                    />
                    Seleccionar todos
                </label>
                <Button onClick={approve} disabled={chosen.length === 0 || saving} className="rounded-xl gap-2 h-10">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                    Aprobar{chosen.length > 0 ? ` ${chosen.length}` : ""}
                </Button>
            </div>

            {byWorker.map(([worker, rows]) => (
                <div key={worker} className="bg-card rounded-[1.5rem] border shadow-sm overflow-hidden">
                    <p className="px-4 pt-3 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground">{worker}</p>
                    <ul className="divide-y">
                        {rows.map(l => (
                            <li key={l.key}>
                                <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/40">
                                    <Checkbox
                                        checked={selected.has(l.key)}
                                        onCheckedChange={(v) => toggle(l.key, !!v)}
                                        aria-label={`${l.materialName} de ${worker}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-bold leading-tight break-words">{l.materialName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {l.quantity} {l.unit || (l.quantity === 1 ? "unidad" : "unidades")}
                                            {" · "}{format(l.createdAt, "d MMM HH:mm", { locale: es })}
                                            {" · "}{formatDistanceToNow(l.createdAt, { addSuffix: true, locale: es })}
                                        </p>
                                    </div>
                                    {l.overdue && (
                                        <span className={cn("shrink-0 flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md bg-destructive/10 text-destructive")}>
                                            <Clock size={10} /> Vencido
                                        </span>
                                    )}
                                </label>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}
