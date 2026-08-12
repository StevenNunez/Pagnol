"use client";

import React, { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldAlert, UserCheck, Send, Loader2 } from "lucide-react";
import { useToast } from "@/modules/core/hooks/use-toast";
import { bearerHeader } from "@/modules/core/lib/auth-header";

export interface ExceptionTarget {
    emp: { id: string; name: string };
    requestId?: string | null;
    transactionCode?: string | null;
}

interface Props {
    target: ExceptionTarget | null;
    onClose: () => void;
    /** Registra la solicitud y devuelve el `exceptionGroupId`. */
    onRequest: (params: {
        subject: { id: string; name: string };
        reason: string;
        requestId?: string | null;
        transactionCode?: string | null;
    }) => Promise<string>;
    /** Deja el hecho de resolución (sólo se usa en el modo presencial). */
    onResolve: (params: {
        exceptionGroupId: string;
        subject: { id: string; name: string };
        approve: boolean;
        mode: 'presencial' | 'remota';
        authorizedBy: { id: string; name: string };
        requestId?: string | null;
        transactionCode?: string | null;
    }) => Promise<void>;
    /** Se llama sólo si la excepción quedó APROBADA en el acto. */
    onApproved: (exceptionGroupId: string) => void;
}

const MOTIVO_MINIMO = 10;

/**
 * Excepción al bloqueo biométrico: la única forma de que un activo salga sin
 * verificación facial.
 *
 * Existe porque el bloqueo sin válvula es peor que la excepción registrada: con
 * una cámara mojada o un trabajador recién ingresado, la faena se detiene y la
 * herramienta termina entregándose por fuera del sistema, sin rastro alguno.
 *
 * Dos vías, según si hay un autorizador a mano:
 *  - **presencial**: el ADC/Administrador teclea sus credenciales acá y la
 *    entrega sale al instante.
 *  - **remota**: queda pendiente en la bandeja de Autorizaciones y la resuelve
 *    desde donde esté. Cubre el turno de noche y la faena aislada.
 */
export function BiometricExceptionDialog({ target, onClose, onRequest, onResolve, onApproved }: Props) {
    const { toast } = useToast();
    const [motivo, setMotivo] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [enviando, setEnviando] = useState<null | 'presencial' | 'remota'>(null);

    const cerrar = () => {
        setMotivo(""); setEmail(""); setPassword(""); setEnviando(null);
        onClose();
    };

    const motivoValido = motivo.trim().length >= MOTIVO_MINIMO;

    const registrarSolicitud = async () => {
        if (!target) throw new Error("Sin destinatario");
        return onRequest({
            subject: target.emp,
            reason: motivo.trim(),
            requestId: target.requestId,
            transactionCode: target.transactionCode,
        });
    };

    /** Vía remota: queda pendiente para que el ADC la resuelva desde su bandeja. */
    const enviarABandeja = async () => {
        if (!target || !motivoValido) return;
        setEnviando('remota');
        try {
            await registrarSolicitud();
            toast({
                variant: 'info',
                title: "Excepción enviada",
                description: "Queda pendiente en Autorizaciones. El ADC o Administrador puede aprobarla desde donde esté.",
            });
            cerrar();
        } catch (e: any) {
            toast({ variant: 'destructive', title: "No se pudo enviar", description: e.message });
            setEnviando(null);
        }
    };

    /** Vía presencial: el autorizador se identifica acá y la entrega sale ya. */
    const autorizarEnElActo = async () => {
        if (!target || !motivoValido || !email || !password) return;
        setEnviando('presencial');
        try {
            // Se valida en el servidor: hacerlo con el cliente compartido cerraría
            // la sesión del pañolero a mitad de la entrega.
            const res = await fetch('/api/biometric/authorize-exception', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(await bearerHeader()) },
                body: JSON.stringify({ email, password }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || 'No se pudo autorizar');

            const grupo = await registrarSolicitud();
            await onResolve({
                exceptionGroupId: grupo,
                subject: target.emp,
                approve: true,
                mode: 'presencial',
                authorizedBy: json.authorizer,
                requestId: target.requestId,
                transactionCode: target.transactionCode,
            });

            toast({
                variant: 'success',
                title: "Excepción autorizada",
                description: `${json.authorizer.name} autorizó la entrega sin biometría. Queda registrado.`,
            });
            onApproved(grupo);
            cerrar();
        } catch (e: any) {
            toast({ variant: 'destructive', title: "No autorizado", description: e.message });
            setEnviando(null);
        }
    };

    return (
        <Dialog open={!!target} onOpenChange={o => { if (!o) cerrar(); }}>
            <DialogContent className="sm:max-w-lg rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="h-5 w-5 text-warning" />
                        Entregar sin verificación biométrica
                    </DialogTitle>
                    <DialogDescription>
                        {target?.emp.name} no puede verificarse con la cámara. Un ADC o Administrador
                        debe autorizar la salida del activo, y quedará registrado quién lo hizo.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            Motivo (obligatorio)
                        </Label>
                        <Textarea
                            value={motivo}
                            onChange={e => setMotivo(e.target.value)}
                            placeholder="Ej: cámara del pañol sin funcionar desde el turno de mañana; trabajador ingresó hoy y aún no se enrola."
                            className="rounded-xl min-h-24"
                        />
                        <p className="text-xs text-muted-foreground">
                            {motivoValido
                                ? "Queda guardado junto a la entrega."
                                : `Faltan ${Math.max(0, MOTIVO_MINIMO - motivo.trim().length)} caracteres.`}
                        </p>
                    </div>

                    <div className="rounded-[1.5rem] border bg-card p-5 space-y-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                            ¿Hay un autorizador presente?
                        </p>
                        <div className="space-y-3">
                            <Input
                                type="email" autoComplete="off" placeholder="Correo del ADC / Administrador"
                                value={email} onChange={e => setEmail(e.target.value)} className="rounded-xl"
                            />
                            <Input
                                type="password" autoComplete="new-password" placeholder="Su contraseña"
                                value={password} onChange={e => setPassword(e.target.value)} className="rounded-xl"
                            />
                        </div>
                        <Button
                            onClick={autorizarEnElActo}
                            disabled={!motivoValido || !email || !password || enviando !== null}
                            className="w-full rounded-xl"
                        >
                            {enviando === 'presencial'
                                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Verificando…</>
                                : <><UserCheck className="mr-2 h-4 w-4" /> Autorizar y entregar ahora</>}
                        </Button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">o</span>
                        <div className="h-px flex-1 bg-border" />
                    </div>

                    <Button
                        variant="outline"
                        onClick={enviarABandeja}
                        disabled={!motivoValido || enviando !== null}
                        className="w-full rounded-xl"
                    >
                        {enviando === 'remota'
                            ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
                            : <><Send className="mr-2 h-4 w-4" /> Enviar a Autorizaciones (no hay nadie acá)</>}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
