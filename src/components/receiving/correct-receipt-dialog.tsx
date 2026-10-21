"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/modules/core/hooks/use-toast";
import { supabase } from "@/modules/core/lib/supabase";
import { Loader2, Undo2 } from "lucide-react";

export interface CorrectableReceiptLine {
    /** `expected_purchase_receipt_lines.id` */
    id: string;
    name: string;
    unit: string | null;
    guide: string;
    /** Lo que de esa recepción sigue en pie (recibido − ya corregido). */
    net: number;
    tracked: boolean;
}

const MICRO = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";

/**
 * Corregir una recepción: «esto no venía». La recepción original NO se edita (respalda lo que pasó
 * ese día): queda una corrección con el motivo, quién y cuándo, y se revierte lo que corresponde.
 * La base decide si se puede (un equipo debe seguir intacto en el pañol; un consumible, seguir en
 * él) y el mensaje dice por qué cuando no.
 */
export function CorrectReceiptDialog({
    line, onClose, onDone,
}: {
    line: CorrectableReceiptLine | null;
    onClose: () => void;
    onDone: () => void;
}) {
    const { toast } = useToast();
    const [qty, setQty] = useState("1");
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    if (!line) return null;
    const n = Number(qty);
    const invalid = Number.isNaN(n) || n <= 0 || n > line.net || (line.tracked && n !== Math.trunc(n));
    const canSubmit = !saving && !invalid && reason.trim().length >= 5;

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc("correct_expected_receipt", {
                p_receipt_line: line.id, p_qty: n, p_reason: reason.trim(),
            });
            if (error) throw new Error(error.message);
            toast({
                variant: "success",
                title: "Recepción corregida",
                description: line.tracked
                    ? `${n} unidad${n !== 1 ? "es" : ""} de ${line.name} se dieron de baja y la línea vuelve a quedar por recibir.`
                    : `Se descontaron ${n} de ${line.name} del stock y la línea vuelve a quedar por recibir.`,
            });
            setQty("1"); setReason("");
            onDone();
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo corregir", description: err?.message || "Intenta nuevamente." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-md rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Undo2 className="h-5 w-5 text-primary" /> Corregir recepción</DialogTitle>
                    <DialogDescription>
                        {line.name} · guía {line.guide}. De esa recepción quedan {line.net}{line.unit ? ` ${line.unit}` : ""}.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className={MICRO}>¿Cuántas NO venían?</label>
                        <Input
                            type="number" inputMode={line.tracked ? "numeric" : "decimal"} min={1} max={line.net} step={line.tracked ? 1 : "any"}
                            value={qty} onChange={e => setQty(e.target.value)}
                            className={`h-11 w-32 rounded-xl ${invalid ? "border-destructive" : ""}`} aria-label="Cantidad que no venía"
                        />
                        {invalid && <p className="text-xs text-destructive">Entre 1 y {line.net}{line.tracked ? ", en unidades enteras" : ""}.</p>}
                    </div>
                    <div className="space-y-1.5">
                        <label className={MICRO}>Qué pasó (queda registrado)</label>
                        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="rounded-xl"
                            placeholder="Ej. la caja traía 2 y no 3; me equivoqué al contar…" />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed rounded-xl bg-muted/40 p-3">
                        {line.tracked
                            ? "Se darán de baja las últimas unidades de esa recepción, sólo si siguen intactas en el pañol (si alguna ya se entregó o se movió, no se puede y te dice cuál)."
                            : "Se descuentan del stock del pañol, sólo si esa cantidad sigue en él. Si ya se entregó parte, no se puede."}
                        {" "}Se le avisa al sistema de compras para que descuente lo que había registrado.
                    </p>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={!canSubmit} className="rounded-xl gap-2">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Corregir
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
