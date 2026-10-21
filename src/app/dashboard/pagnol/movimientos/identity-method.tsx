'use client';

import { useEffect, useRef } from 'react';
import { CreditCard, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Las dos formas de acreditar a una persona en el pañol: el rostro o el carnet. Se elige UNA
// al empezar y sólo esa queda activa: así la cámara del rostro no compite con el lector de
// carnets (pistola o cámara), que antes se pisaban en la misma pantalla.
export type IdMethod = 'choose' | 'face' | 'carnet';

interface ChoiceProps {
    onFace: () => void;
    onCarnet: () => void;
    /** Si el rostro no se puede usar (p. ej. la persona no tiene rostro enrolado), por qué. */
    faceDisabledReason?: string;
}

export function IdentityMethodChoice({ onFace, onCarnet, faceDisabledReason }: ChoiceProps) {
    const faceOff = !!faceDisabledReason;
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
            <button
                type="button"
                onClick={onFace}
                disabled={faceOff}
                className="group rounded-[1.5rem] border border-border bg-card p-6 flex flex-col items-start gap-3 text-left transition-all hover:border-primary hover:bg-primary/5 disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-card"
            >
                <span className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <ScanFace size={26} />
                </span>
                <span className="font-black uppercase text-sm tracking-tight text-foreground">Reconocimiento facial</span>
                <span className="text-[11px] font-medium text-muted-foreground leading-snug">
                    {faceOff ? faceDisabledReason : 'Mire a la cámara. Se activa la cámara frontal.'}
                </span>
            </button>
            <button
                type="button"
                onClick={onCarnet}
                className="group rounded-[1.5rem] border border-border bg-card p-6 flex flex-col items-start gap-3 text-left transition-all hover:border-primary hover:bg-primary/5"
            >
                <span className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <CreditCard size={26} />
                </span>
                <span className="font-black uppercase text-sm tracking-tight text-foreground">Carnet de identidad</span>
                <span className="text-[11px] font-medium text-muted-foreground leading-snug">
                    Pase el carnet por el lector, escanéelo con la cámara o escriba el RUT.
                </span>
            </button>
        </div>
    );
}

interface CarnetProps {
    value: string;
    onChange: (v: string) => void;
    /** Se llama al terminar de escribir/pasar el carnet (Enter, que es lo que manda la pistola). */
    onSubmit: (v: string) => void;
    onCamera: () => void;
    placeholder?: string;
}

/** Entrada del carnet. Toma el foco al aparecer para que la pistola escriba directo en ella. */
export function CarnetEntry({ value, onChange, onSubmit, onCamera, placeholder = 'Pase el carnet o escriba el RUT…' }: CarnetProps) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => { ref.current?.focus(); }, []);
    return (
        <div className="space-y-3 text-left">
            <div className="flex items-center gap-2">
                <Input
                    ref={ref}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && value.trim()) {
                            e.preventDefault();
                            onSubmit(value);
                        }
                    }}
                    placeholder={placeholder}
                    autoComplete="off"
                    className="h-12 rounded-xl border-border bg-muted text-sm"
                    aria-label="RUT o lectura del carnet"
                />
                <Button
                    type="button"
                    variant="secondary"
                    className="h-12 shrink-0 rounded-xl gap-2 font-black uppercase text-[10px] tracking-widest"
                    onClick={onCamera}
                >
                    <CreditCard size={16} /> Cámara
                </Button>
            </div>
            <p className="text-[10px] font-medium text-muted-foreground">
                El lector escribe solo en este campo. Con la cámara, encuadre el código del carnet.
            </p>
        </div>
    );
}
