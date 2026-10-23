'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, KeyRound, ShieldCheck } from 'lucide-react';
import { createPin, getPinStatus, PinError, verifyPin, type PinStatus } from '@/modules/core/lib/pin-client';
import { PIN_LENGTH, pinFormatError, PIN_FORMAT_MESSAGE } from '@/lib/pin';

/**
 * Aceptación de una entrega identificada con carnet: el TRABAJADOR digita su PIN
 * y confirma lo que recibe. Ese acto es la aceptación; el carnet sólo dice quién
 * es. Si todavía no tiene PIN lo crea acá mismo (dos veces, para no equivocarse).
 *
 * Pensado para un teclado numérico frente al trabajador: el campo va enmascarado
 * y acepta Enter. El pañolero no digita nada en esta pantalla.
 *
 * Sólo se muestra cuando la empresa exige PIN (`carnetPinRequired`). Apagado, la
 * entrega por carnet funciona como siempre y este diálogo nunca se abre.
 */
export function PinDialog({
    open, worker, items, trace, onVerified, onCancel,
}: {
    open: boolean;
    worker: { id: string; name: string } | null;
    /** Lo que recibe, ya redactado («2 × Casco de seguridad»). */
    items: string[];
    trace: { requestId?: string | null; transactionCode?: string | null };
    onVerified: (verificationId: string) => void;
    onCancel: () => void;
}) {
    const [status, setStatus] = useState<PinStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pin, setPin] = useState('');
    const [pin2, setPin2] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const firstRef = useRef<HTMLInputElement>(null);

    // Al abrir: ¿ya tiene PIN? ¿está bloqueado?
    useEffect(() => {
        if (!open || !worker) return;
        let alive = true;
        setStatus(null); setLoadError(null); setPin(''); setPin2(''); setError(null);
        getPinStatus(worker.id)
            .then(s => { if (alive) setStatus(s); })
            .catch(e => { if (alive) setLoadError(e?.message || 'No se pudo revisar el PIN.'); });
        return () => { alive = false; };
    }, [open, worker]);

    useEffect(() => { if (status && !status.locked) setTimeout(() => firstRef.current?.focus(), 50); }, [status]);

    if (!worker) return null;
    const creating = !!status && !status.hasPin;
    const digits = (v: string) => v.replace(/\D/g, '').slice(0, PIN_LENGTH);

    const canSubmit = !busy && !!status && !status.locked && pin.length === PIN_LENGTH && (!creating || pin2.length === PIN_LENGTH);

    const submit = async () => {
        if (!canSubmit) return;
        setError(null);
        if (creating) {
            const bad = pinFormatError(pin);
            if (bad) { setError(PIN_FORMAT_MESSAGE[bad]); return; }
            if (pin !== pin2) { setError('Los dos PIN no coinciden. Vuelve a escribirlos.'); setPin2(''); return; }
        }
        setBusy(true);
        try {
            if (creating) await createPin(worker.id, pin);
            const { verificationId } = await verifyPin(worker.id, pin, trace);
            setPin(''); setPin2('');
            onVerified(verificationId);
        } catch (e: any) {
            const code = e instanceof PinError ? e.code : 'error';
            setError(e?.message || 'No se pudo validar el PIN.');
            setPin('');
            if (code === 'locked') setStatus(s => (s ? { ...s, locked: true, minutesLeft: (e as PinError).minutesLeft ?? s.minutesLeft } : s));
            firstRef.current?.focus();
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onCancel(); }}>
            <DialogContent className="max-w-md rounded-[1.5rem]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <KeyRound className="h-5 w-5 text-primary" /> {creating ? 'Crea tu PIN' : 'Confirma con tu PIN'}
                    </DialogTitle>
                    <DialogDescription>
                        {worker.name}, {creating
                            ? `elige ${PIN_LENGTH} números que sólo tú sepas. Los usarás cada vez que retires algo. No se lo digas a nadie.`
                            : 'digita tu PIN para confirmar que recibiste lo siguiente.'}
                    </DialogDescription>
                </DialogHeader>

                <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recibes</p>
                    <ul className="text-sm space-y-0.5 max-h-32 overflow-y-auto">
                        {items.map((it, i) => <li key={i} className="font-semibold">{it}</li>)}
                    </ul>
                </div>

                {loadError && <p className="text-sm text-destructive">{loadError}</p>}
                {!status && !loadError && (
                    <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Revisando…</p>
                )}

                {status?.locked && (
                    <p className="text-sm text-destructive">
                        El PIN está bloqueado por demasiados intentos. Reintenta en {status.minutesLeft} min, o pídele a RR.HH. que lo restablezca.
                    </p>
                )}

                {status && !status.locked && (
                    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                {creating ? 'Tu nuevo PIN' : 'Tu PIN'}
                            </label>
                            <Input ref={firstRef} type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH}
                                value={pin} onChange={e => setPin(digits(e.target.value))}
                                className="h-14 rounded-xl text-center text-2xl tracking-[0.6em]" aria-label="PIN" />
                        </div>
                        {creating && (
                            <div className="space-y-1.5">
                                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Repítelo</label>
                                <Input type="password" inputMode="numeric" autoComplete="off" maxLength={PIN_LENGTH}
                                    value={pin2} onChange={e => setPin2(digits(e.target.value))}
                                    className="h-14 rounded-xl text-center text-2xl tracking-[0.6em]" aria-label="Repite el PIN" />
                            </div>
                        )}
                        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
                        <Button type="submit" disabled={!canSubmit} className="w-full h-12 rounded-xl font-black uppercase text-xs tracking-widest gap-2">
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            {creating ? 'Crear PIN y confirmar que recibí' : 'Confirmo que recibí'}
                        </Button>
                    </form>
                )}

                <Button variant="ghost" onClick={onCancel} disabled={busy} className="rounded-xl text-xs">Cancelar</Button>
            </DialogContent>
        </Dialog>
    );
}
