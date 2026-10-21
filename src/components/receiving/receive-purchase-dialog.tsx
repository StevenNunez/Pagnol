"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/modules/core/hooks/use-toast";
import { supabase } from "@/modules/core/lib/supabase";
import { format } from "date-fns";
import { Loader2, PackageCheck } from "lucide-react";

export interface ReceivableLine {
    id: string;
    name: string;
    unit: string | null;
    expected: number;
    received: number;
    /** Equipo con identidad propia: se recibe en unidades enteras y cada una recibe su código y QR. */
    tracked: boolean;
}

const MICRO = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";
const todayInput = () => format(new Date(), "yyyy-MM-dd");

/**
 * Registrar lo que llegó de una compra anunciada. Cada línea parte con lo que falta (se puede
 * bajar o dejar en 0 si no llegó). La guía es obligatoria. Todo lo valida y lo escribe la base en
 * una sola transacción: si algo falla no queda nada a medias, y el mensaje dice por qué.
 */
export function ReceivePurchaseDialog({
    purchase, onClose, onDone,
}: {
    purchase: { id: string; title: string; warehouse: string; lines: ReceivableLine[] } | null;
    onClose: () => void;
    onDone: () => void;
}) {
    const { toast } = useToast();
    const [guide, setGuide] = useState("");
    const [date, setDate] = useState(todayInput());
    const [note, setNote] = useState("");
    const [qty, setQty] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);

    // Se parte de lo que falta en cada línea.
    const remaining = (l: ReceivableLine) => Math.max(l.expected - l.received, 0);
    const value = (l: ReceivableLine) => qty[l.id] ?? String(remaining(l));
    const num = (l: ReceivableLine) => Number(value(l));

    const lines = purchase?.lines.filter(l => remaining(l) > 0) ?? [];
    const picked = useMemo(() => lines.filter(l => num(l) > 0), [lines, qty]); // eslint-disable-line react-hooks/exhaustive-deps
    const invalid = lines.some(l => {
        const n = num(l);
        return Number.isNaN(n) || n < 0 || n > remaining(l) || (l.tracked && n !== Math.trunc(n));
    });
    const canSubmit = !saving && !!purchase && guide.trim().length > 0 && !!date && picked.length > 0 && !invalid;

    const submit = async () => {
        if (!purchase || !canSubmit) return;
        setSaving(true);
        try {
            const { error } = await supabase.rpc("receive_expected_purchase", {
                p_purchase: purchase.id,
                p_guide: guide.trim(),
                p_date: date,
                p_note: note.trim() || null,
                p_lines: picked.map(l => ({ line_id: l.id, cantidad: num(l) })),
            });
            if (error) throw new Error(error.message);
            toast({
                variant: "success",
                title: "Recepción registrada",
                description: `${picked.length} línea${picked.length !== 1 ? "s" : ""} recibida${picked.length !== 1 ? "s" : ""}. Ya quedó en el stock y se avisó al sistema de compras.`,
            });
            setGuide(""); setNote(""); setQty({});
            onDone();
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo registrar", description: err?.message || "Intenta nuevamente." });
        } finally {
            setSaving(false);
        }
    };

    if (!purchase) return null;
    return (
        <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" /> Recibir compra de {purchase.title}</DialogTitle>
                    <DialogDescription>Llega a {purchase.warehouse}. Marca lo que realmente llegó.</DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <label className={MICRO}>Guía de despacho *</label>
                            <Input value={guide} onChange={e => setGuide(e.target.value)} placeholder="N° de guía" className="h-11 rounded-xl" autoComplete="off" />
                        </div>
                        <div className="space-y-1.5">
                            <label className={MICRO}>Fecha de recepción</label>
                            <Input type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} className="h-11 rounded-xl" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className={MICRO}>Qué llegó</label>
                        <ul className="space-y-2">
                            {lines.map(l => {
                                const n = num(l);
                                const bad = Number.isNaN(n) || n < 0 || n > remaining(l) || (l.tracked && n !== Math.trunc(n));
                                return (
                                    <li key={l.id} className="flex items-center gap-3 rounded-xl border p-3">
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold leading-tight break-words">{l.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                Faltan {remaining(l)} de {l.expected}{l.unit ? ` ${l.unit}` : ""}
                                                {l.tracked ? " · cada unidad recibe su código y QR" : ""}
                                            </p>
                                        </div>
                                        <Input
                                            type="number" inputMode={l.tracked ? "numeric" : "decimal"} min={0} max={remaining(l)} step={l.tracked ? 1 : "any"}
                                            value={value(l)} onChange={e => setQty(prev => ({ ...prev, [l.id]: e.target.value }))}
                                            className={`h-10 w-24 rounded-xl text-right ${bad ? "border-destructive" : ""}`} aria-label={`Cantidad recibida de ${l.name}`}
                                        />
                                    </li>
                                );
                            })}
                        </ul>
                        {invalid && <p className="text-xs text-destructive">Revisa las cantidades: no pueden pasar de lo que falta{lines.some(l => l.tracked) ? " y los equipos van en unidades enteras" : ""}.</p>}
                    </div>

                    <div className="space-y-1.5">
                        <label className={MICRO}>Observación (opcional)</label>
                        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} className="rounded-xl" placeholder="Ej. caja golpeada, llegó incompleto…" />
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={!canSubmit} className="rounded-xl gap-2">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Registrar recepción
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
