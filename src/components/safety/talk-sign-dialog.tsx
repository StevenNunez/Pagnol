"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/modules/core/hooks/use-toast";
import { cn } from "@/lib/utils";
import SignaturePad from "@/components/signature-pad";
import { Camera, Loader2, PenLine, ScanFace } from "lucide-react";
import { signOnTalk } from "@/modules/core/lib/daily-talk-client";

type Mode = "face" | "handwritten";

/**
 * Firma de asistencia en el equipo de quien lleva la charla (el trabajador no
 * tiene cuenta, o no está a mano su celular). Dos maneras de acreditar quién es:
 *   · rostro → el servidor compara contra el rostro enrolado;
 *   · firma manuscrita → para quien no tiene rostro enrolado; queda anotado que
 *     la tomó el responsable.
 */
export function TalkSignDialog({
    talkId, worker, onClose,
}: {
    talkId: string;
    worker: { id: string; name: string; enrolled: boolean } | null;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [mode, setMode] = useState<Mode>("handwritten");
    const [understood, setUnderstood] = useState(false);
    const [ink, setInk] = useState("");
    const [busy, setBusy] = useState(false);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);

    // Cada vez que se abre para otra persona se parte de cero.
    useEffect(() => {
        setMode(worker?.enrolled ? "face" : "handwritten");
        setUnderstood(false);
        setInk("");
        setCameraError(null);
    }, [worker?.id, worker?.enrolled]);

    // La cámara sólo se enciende en modo rostro y siempre se apaga al salir.
    useEffect(() => {
        const stop = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
        if (!worker || mode !== "face") { stop(); return; }
        let alive = true;
        navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
            .then(stream => {
                if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
                streamRef.current = stream;
                if (videoRef.current) { videoRef.current.srcObject = stream; void videoRef.current.play().catch(() => {}); }
            })
            .catch(() => alive && setCameraError("No se pudo abrir la cámara. Usa la firma manuscrita."));
        return () => { alive = false; stop(); };
    }, [worker, mode]);

    if (!worker) return null;

    const submit = async () => {
        setBusy(true);
        try {
            if (mode === "face") {
                if (!videoRef.current) throw new Error("La cámara no está lista.");
                const { captureBiometrics } = await import("@/lib/biometricService");
                const cap = await captureBiometrics(videoRef.current);
                if (!cap.success || !cap.template) throw new Error(cap.message || "No se detectó el rostro. Acércate a la cámara.");
                await signOnTalk({
                    talkId, method: "face", workerId: worker.id, acknowledged: understood,
                    descriptor: JSON.parse(cap.template) as number[],
                });
            } else {
                if (!ink) throw new Error("Falta la firma.");
                await signOnTalk({ talkId, method: "handwritten", workerId: worker.id, acknowledged: understood, signature: ink });
            }
            toast({ variant: "success", title: "Asistencia firmada", description: `${worker.name} quedó registrado.` });
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo firmar", description: err?.message || "Intenta nuevamente." });
        } finally {
            setBusy(false);
        }
    };

    const canSubmit = !busy && (mode === "face" ? !cameraError : !!ink);

    return (
        <Dialog open onOpenChange={(v) => { if (!v && !busy) onClose(); }}>
            <DialogContent className="max-w-md rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle>Firma de {worker.name}</DialogTitle>
                    <DialogDescription>Pásale el equipo a la persona para que confirme su asistencia.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        {([
                            { key: "face" as const, label: "Rostro", icon: ScanFace, disabled: !worker.enrolled },
                            { key: "handwritten" as const, label: "Firma a mano", icon: PenLine, disabled: false },
                        ]).map(o => (
                            <button key={o.key} type="button" disabled={o.disabled || busy} onClick={() => setMode(o.key)}
                                aria-pressed={mode === o.key}
                                className={cn("p-3 rounded-xl border-2 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40",
                                    mode === o.key ? "border-primary bg-primary/5" : "border-border")}>
                                <o.icon className="h-4 w-4" /> {o.label}
                            </button>
                        ))}
                    </div>
                    {!worker.enrolled && (
                        <p className="text-xs text-muted-foreground">No tiene el rostro enrolado: se firma a mano y queda anotado que la tomó el responsable.</p>
                    )}

                    {mode === "face" ? (
                        <div className="rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
                            {cameraError
                                ? <p className="text-sm text-white p-4 text-center">{cameraError}</p>
                                : <video ref={videoRef} muted playsInline className="w-full h-full object-cover -scale-x-100" />}
                        </div>
                    ) : (
                        <div className="rounded-xl border bg-white">
                            <SignaturePad onEnd={setInk} canvasProps={{ className: "w-full h-40 touch-none" }} />
                        </div>
                    )}

                    <label className="flex items-start gap-3 text-sm cursor-pointer">
                        <Checkbox checked={understood} onCheckedChange={(v) => setUnderstood(!!v)} className="mt-0.5" />
                        <span>
                            <b>Entendí los temas tratados.</b>
                            <span className="block text-xs text-muted-foreground">Aparte de haber asistido. Si algo no quedó claro, déjalo sin marcar.</span>
                        </span>
                    </label>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={busy} className="rounded-xl">Cancelar</Button>
                    <Button onClick={submit} disabled={!canSubmit} className="rounded-xl gap-2">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                        {mode === "face" ? "Verificar y firmar" : "Firmar"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
