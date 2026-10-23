"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/modules/core/hooks/use-toast";
import { Loader2, ScanFace } from "lucide-react";
import { eraseBiometricData, type EraseReason } from "@/modules/core/lib/biometric-erase-client";

/**
 * Borrar el rostro y las fotos de la cédula de una persona. Es lo que el
 * trabajador autorizó poder pedir en el consentimiento: retirar su autorización,
 * o que se borre al salir de la empresa.
 *
 * Se explica qué se borra y qué NO, porque lo segundo es lo que alguien va a
 * preguntar: la constancia de que autorizó y el registro de las entregas se
 * conservan (son la prueba de lo que pasó).
 */
export function EraseBiometricsDialog({
    userName, userId, reason, open, onClose,
}: {
    userName: string;
    userId: string;
    reason: EraseReason;
    open: boolean;
    onClose: () => void;
}) {
    const { toast } = useToast();
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try {
            await eraseBiometricData(userId, reason);
            toast({
                variant: "success",
                title: "Datos biométricos borrados",
                description: "Quedó anotado quién lo hizo y cuándo.",
            });
            onClose();
        } catch (err: any) {
            toast({ variant: "destructive", title: "No se pudo borrar", description: err?.message || "Intenta nuevamente." });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
            <DialogContent className="max-w-md rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ScanFace className="h-5 w-5 text-destructive" /> Borrar datos biométricos de {userName}
                    </DialogTitle>
                    <DialogDescription>
                        {reason === "revocation"
                            ? "Úsalo cuando la persona retira su autorización."
                            : "Salió de la empresa y quedó pendiente porque tenía equipos por devolver."}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                    <div className="rounded-xl border p-3 space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Se borra</p>
                        <ul className="list-disc pl-5 text-xs leading-relaxed">
                            <li>La plantilla de su rostro.</li>
                            <li>Su selfie y las fotos de su cédula.</li>
                        </ul>
                    </div>
                    <div className="rounded-xl border p-3 space-y-1 bg-muted/30">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Se conserva</p>
                        <ul className="list-disc pl-5 text-xs leading-relaxed">
                            <li>La constancia de que autorizó.</li>
                            <li>El registro de las entregas y devoluciones en que participó.</li>
                        </ul>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        No se puede deshacer. Sin su rostro registrado, tendrá que identificarse con el carnet
                        (o con una excepción autorizada) hasta que se vuelva a enrolar.
                    </p>
                </div>

                <DialogFooter className="gap-2 sm:gap-2">
                    <Button variant="outline" onClick={onClose} disabled={saving} className="rounded-xl">Cancelar</Button>
                    <Button variant="destructive" onClick={submit} disabled={saving} className="rounded-xl gap-2">
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />} Borrar ahora
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
