"use client";

import { useState } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CheckCircle2, AlertTriangle, XCircle, Loader2, PackageCheck } from 'lucide-react';
import type { ReturnRequest } from '@/modules/core/lib/data';
import type { ReturnCondition } from './request-shared';

const OPTIONS: { value: ReturnCondition; label: string; desc: string; icon: any; cls: string; activeCls: string }[] = [
    { value: 'OK', label: 'En buen estado', desc: 'Vuelve a stock, disponible para despacho', icon: CheckCircle2, cls: 'text-success', activeCls: 'border-success bg-success-subtle' },
    { value: 'CON FALLA', label: 'Con falla', desc: 'Ingresa pero queda en mantenimiento', icon: AlertTriangle, cls: 'text-warning', activeCls: 'border-warning bg-warning-subtle' },
    { value: 'ROTO', label: 'Roto / inservible', desc: 'Ingresa pero queda en mantenimiento', icon: XCircle, cls: 'text-destructive', activeCls: 'border-destructive bg-destructive/10' },
];

interface ReturnAcceptDialogProps {
    request: ReturnRequest;
    onClose: () => void;
    onConfirm: (condition: ReturnCondition) => Promise<void>;
}

/**
 * Cierre de una devolución en el pañol. OBLIGA a declarar la condición del ítem
 * — sin esto la mutación asumía "no OK" y mandaba TODO a mantenimiento.
 */
export function ReturnAcceptDialog({ request, onClose, onConfirm }: ReturnAcceptDialogProps) {
    const [condition, setCondition] = useState<ReturnCondition>('OK');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm(condition);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const goesToMaintenance = condition !== 'OK';

    return (
        <Dialog open onOpenChange={(open) => { if (!open && !isSubmitting) onClose(); }}>
            <DialogContent className="max-w-lg rounded-[2rem] p-0 overflow-hidden border-none shadow-2xl">
                <DialogHeader className="p-8 pb-6 bg-pagnol-dark text-white">
                    <DialogTitle className="text-xl font-black uppercase tracking-tighter text-white flex items-center gap-3">
                        <PackageCheck size={22} className="text-pagnol-orange" /> Recepción de Devolución
                    </DialogTitle>
                    <DialogDescription className="text-white/50 text-xs font-medium mt-1">
                        Ingresarán <strong className="text-white">{request.quantity} {request.unit}</strong> de <strong className="text-white">{request.materialName}</strong> al inventario. Declara en qué estado se recibe.
                    </DialogDescription>
                </DialogHeader>

                <div className="p-8 space-y-3">
                    {OPTIONS.map(opt => {
                        const Icon = opt.icon;
                        const active = condition === opt.value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                onClick={() => setCondition(opt.value)}
                                className={cn(
                                    'w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all',
                                    active ? opt.activeCls : 'border-border bg-card hover:bg-muted',
                                )}
                            >
                                <Icon size={24} className={cn('shrink-0', active ? opt.cls : 'text-muted-foreground')} />
                                <div className="min-w-0">
                                    <p className={cn('text-sm font-black uppercase tracking-tight', active ? 'text-foreground' : 'text-muted-foreground')}>{opt.label}</p>
                                    <p className="text-[11px] text-muted-foreground font-medium">{opt.desc}</p>
                                </div>
                                <div className={cn('ml-auto w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center', active ? `${opt.cls} border-current` : 'border-border')}>
                                    {active && <div className="w-2.5 h-2.5 rounded-full bg-current" />}
                                </div>
                            </button>
                        );
                    })}

                    {goesToMaintenance && (
                        <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning-subtle border border-warning/20">
                            <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" />
                            <p className="text-[11px] text-warning font-bold uppercase tracking-wide leading-relaxed">
                                El activo ingresará pero quedará bloqueado en mantenimiento hasta ser revisado.
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="p-8 pt-0 flex-row justify-end gap-3">
                    <Button variant="ghost" onClick={onClose} disabled={isSubmitting} className="rounded-2xl h-12 px-6 text-[11px] font-black uppercase tracking-widest">
                        Cancelar
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={isSubmitting}
                        className="rounded-2xl h-12 px-8 text-[11px] font-black uppercase tracking-widest bg-success text-success-foreground hover:bg-success/90 gap-2"
                    >
                        {isSubmitting ? <><Loader2 size={16} className="animate-spin" /> Ingresando…</> : <><PackageCheck size={16} /> Confirmar Ingreso</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
