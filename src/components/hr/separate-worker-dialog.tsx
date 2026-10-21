"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, Building2, FileSignature, Loader2, UserMinus, Wrench } from "lucide-react";
import type { User } from "@/modules/core/lib/data";
import {
    SEPARATION_REASON_LABEL, type PendingItem, type SeparationReason, type SeparationScope,
} from "@/lib/worker-separation";
import { fetchPendingEquipment, separateWorker } from "@/modules/core/lib/worker-separation-client";

const MICRO_LABEL = "text-[10px] font-black uppercase tracking-widest text-muted-foreground";
const todayInput = () => format(new Date(), "yyyy-MM-dd");

/**
 * Desvincular a un trabajador. Son dos salidas distintas y no se mezclan:
 *   · del CONTRATO: deja esa faena, sigue en la empresa y en sus otros contratos;
 *   · de la EMPRESA: deja de ser trabajador activo en todo.
 * Nada se borra: queda el hecho (quién, cuándo, por qué, qué debía devolver) y
 * todo su historial de entregas, firmas y solicitudes.
 */
export function SeparateWorkerDialog({
    user, open, onClose, assignments,
}: {
    user: User;
    open: boolean;
    onClose: () => void;
    /** Contratos vigentes del trabajador. */
    assignments: { contractId: string; name: string }[];
}) {
    const { toast } = useToast();
    const [scope, setScope] = useState<SeparationScope>(assignments.length > 0 ? "contract" : "company");
    const [contractId, setContractId] = useState(assignments[0]?.contractId ?? "");
    const [date, setDate] = useState(todayInput());
    const [reasonKind, setReasonKind] = useState<SeparationReason>("renuncia");
    const [reason, setReason] = useState("");
    const [pending, setPending] = useState<PendingItem[] | null>(null);
    const [pendingError, setPendingError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Lo que debe devolver se muestra ANTES de confirmar: es lo que hace pensar dos veces.
    useEffect(() => {
        if (!open) return;
        let alive = true;
        setPending(null);
        setPendingError(null);
        fetchPendingEquipment(user.id)
            .then(p => { if (alive) setPending(p); })
            .catch(e => { if (alive) setPendingError(e?.message || "No se pudo revisar lo pendiente."); });
        return () => { alive = false; };
    }, [open, user.id]);

    const canSubmit = useMemo(
        () => !saving && reason.trim().length > 0 && !!date && (scope === "company" || !!contractId),
        [saving, reason, date, scope, contractId],
    );

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const r = await separateWorker({
                workerId: user.id, scope, contractId: scope === "contract" ? contractId : null,
                effectiveDate: date, reasonKind, reason: reason.trim(),
            });
            toast({
                variant: "success",
                title: scope === "company" ? "Trabajador desvinculado" : "Desvinculado del contrato",
                description: r.pending.length > 0
                    ? `Quedaron ${r.pending.length} equipo${r.pending.length !== 1 ? "s" : ""} por devolver${r.notified > 0 ? "; se avisó a bodega y a su supervisor." : "."}`
                    : "No tenía equipos pendientes de devolución.",
            });
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo desvincular", description: err?.message || "Intenta nuevamente." });
        } finally {
            setSaving(false);
        }
    };

    const scopes: { key: SeparationScope; title: string; body: string; icon: typeof Building2; disabled?: boolean }[] = [
        {
            key: "contract", title: "Del contrato", icon: FileSignature, disabled: assignments.length === 0,
            body: assignments.length === 0
                ? "No tiene contratos vigentes."
                : "Deja esa faena. Sigue en la empresa y en sus otros contratos.",
        },
        {
            key: "company", title: "De la empresa", icon: Building2,
            body: "Deja de ser trabajador activo: no podrá retirar nada y se cierra su acceso a Pagnol.",
        },
    ];

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><UserMinus className="h-5 w-5 text-destructive" /> Desvincular a {user.name}</DialogTitle>
                    <DialogDescription>Su historial de entregas, firmas y solicitudes se conserva completo.</DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="grid gap-2 sm:grid-cols-2">
                        {scopes.map(s => (
                            <button key={s.key} type="button" disabled={s.disabled} onClick={() => setScope(s.key)}
                                aria-pressed={scope === s.key}
                                className={cn("text-left p-3 rounded-xl border-2 transition-all disabled:opacity-50",
                                    scope === s.key ? "border-primary bg-primary/5" : "border-border hover:border-primary/40")}>
                                <p className="text-sm font-bold flex items-center gap-2"><s.icon className="h-4 w-4" /> {s.title}</p>
                                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{s.body}</p>
                            </button>
                        ))}
                    </div>

                    {scope === "contract" && assignments.length > 0 && (
                        <div className="space-y-1.5">
                            <label className={MICRO_LABEL}>Contrato</label>
                            <select value={contractId} onChange={e => setContractId(e.target.value)}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                {assignments.map(a => <option key={a.contractId} value={a.contractId}>{a.name}</option>)}
                            </select>
                        </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <label className={MICRO_LABEL}>Fecha</label>
                            <Input type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} className="h-11 rounded-xl" />
                        </div>
                        <div className="space-y-1.5">
                            <label className={MICRO_LABEL}>Motivo</label>
                            <select value={reasonKind} onChange={e => setReasonKind(e.target.value as SeparationReason)}
                                className="h-11 w-full rounded-xl border bg-background px-3 text-sm">
                                {(Object.keys(SEPARATION_REASON_LABEL) as SeparationReason[]).map(k =>
                                    <option key={k} value={k}>{SEPARATION_REASON_LABEL[k]}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label className={MICRO_LABEL}>Detalle</label>
                        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="rounded-xl"
                            placeholder="Qué pasó, en pocas palabras. Queda registrado." />
                    </div>

                    <div className={cn("rounded-xl border p-3 text-sm space-y-2",
                        pending && pending.length > 0 ? "border-warning/50 bg-warning-subtle" : "bg-muted/30")}>
                        <p className="font-bold flex items-center gap-2">
                            <Wrench className="h-4 w-4" /> Equipos sin devolver
                        </p>
                        {pending === null && !pendingError && (
                            <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Revisando…</p>
                        )}
                        {pendingError && (
                            <p className="text-xs text-destructive flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> {pendingError}</p>
                        )}
                        {pending && pending.length === 0 && (
                            <p className="text-xs text-muted-foreground">No tiene equipos ni herramientas pendientes.</p>
                        )}
                        {pending && pending.length > 0 && (
                            <>
                                <ul className="text-xs space-y-1">
                                    {pending.map(p => (
                                        <li key={p.materialId} className="flex justify-between gap-3">
                                            <span className="font-semibold">{p.name}</span>
                                            <span className="text-muted-foreground shrink-0">
                                                desde {formatDistanceToNow(new Date(p.since), { locale: es })}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                                <p className="text-xs text-muted-foreground">
                                    Se desvincula igual, pero se avisa a bodega y a su supervisor, y queda el pendiente anotado.
                                </p>
                            </>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
                    <Button variant="destructive" onClick={submit} disabled={!canSubmit || pending === null && !pendingError} className="rounded-xl gap-2">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Desvincular
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

/** Reincorporar a quien estaba desvinculado de la empresa. Es un hecho nuevo, no un deshacer. */
export function ReinstateWorkerDialog({ user, open, onClose }: { user: User; open: boolean; onClose: () => void }) {
    const { toast } = useToast();
    const [date, setDate] = useState(todayInput());
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!reason.trim() || saving) return;
        setSaving(true);
        try {
            const { reinstateWorker } = await import("@/modules/core/lib/worker-separation-client");
            await reinstateWorker({ workerId: user.id, scope: "company", effectiveDate: date, reason: reason.trim() });
            toast({ variant: "success", title: "Trabajador reincorporado", description: "Vuelve a estar activo. Sus asignaciones a contratos se vuelven a hacer a mano." });
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo reincorporar", description: err?.message || "Intenta nuevamente." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-md rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle>Reincorporar a {user.name}</DialogTitle>
                    <DialogDescription>Queda anotado junto a la desvinculación anterior; ninguna se borra.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className={MICRO_LABEL}>Fecha</label>
                        <Input type="date" value={date} max={todayInput()} onChange={e => setDate(e.target.value)} className="h-11 rounded-xl" />
                    </div>
                    <div className="space-y-1.5">
                        <label className={MICRO_LABEL}>Motivo</label>
                        <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="rounded-xl" placeholder="Por qué vuelve." />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={!reason.trim() || saving} className="rounded-xl gap-2">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Reincorporar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
