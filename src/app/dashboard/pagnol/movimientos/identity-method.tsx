'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCard, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parecePistolaMalConfigurada } from '@/lib/cedula';

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
    /** Se llama al terminar de escribir/pasar el carnet (Enter, o solo cuando lo leído ya es válido). */
    onSubmit: (v: string) => void;
    onCamera: () => void;
    /**
     * Cómo entender lo leído (devuelve algo si es un carnet/RUT válido, null si no). Con esto el
     * campo se envía SOLO apenas lo leído es válido —una pistola sin "Enter" al final no quedaba
     * haciendo nada— y, si no se entiende, muestra qué llegó en vez de callar.
     */
    parse?: (raw: string) => unknown;
    /** Qué pasó con la última lectura (p. ej. «se leyó el RUT X, pero nadie lo tiene»); queda a la vista. */
    note?: string | null;
    placeholder?: string;
}

/** Espera tras la última tecla antes de enviar solo: la pistola escribe en milisegundos, una persona no. */
const IDLE_MS = 400;

/** Entrada del carnet. Toma el foco al aparecer (y lo recupera) para que la pistola escriba directo en ella. */
export function CarnetEntry({ value, onChange, onSubmit, onCamera, parse, note, placeholder = 'Pase el carnet o escriba el RUT…' }: CarnetProps) {
    const ref = useRef<HTMLInputElement>(null);
    const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null);
    useEffect(() => { ref.current?.focus(); }, []);

    // Envía solo cuando lo leído ya es un carnet/RUT válido y no llegan más teclas.
    useEffect(() => {
        const t = value.trim();
        if (!parse || !t || !parse(t)) return;
        const id = setTimeout(() => { setLast({ text: t, ok: true }); onSubmit(t); }, IDLE_MS);
        return () => clearTimeout(id);
        // `onSubmit` y `parse` llegan nuevos en cada render del padre: depender de ellos reiniciaría la espera.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const enviar = (v: string) => {
        const t = v.trim();
        if (!t) return;
        setLast({ text: t, ok: parse ? !!parse(t) : true });
        onSubmit(t);
    };

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
                            enviar(value);
                        }
                    }}
                    // Si el foco se pierde en la nada (un clic en el texto), la pistola dejaría de escribir.
                    onBlur={() => { setTimeout(() => { if (document.activeElement === document.body) ref.current?.focus(); }, 50); }}
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
            {note && (
                <div className="rounded-xl bg-warning-subtle text-warning-subtle-foreground px-4 py-3" role="status">
                    <p className="text-[10px] font-black uppercase tracking-widest">No se encontró a la persona</p>
                    <p className="mt-1 text-[11px] font-medium leading-snug">{note}</p>
                </div>
            )}
            {last && !last.ok && (
                <div className="rounded-xl bg-warning-subtle text-warning-subtle-foreground px-4 py-3" role="status">
                    <p className="text-[10px] font-black uppercase tracking-widest">No se pudo entender lo leído</p>
                    <p className="mt-1 text-[11px] font-mono break-all">«{last.text.slice(0, 80)}{last.text.length > 80 ? '…' : ''}»</p>
                    <p className="mt-1 text-[11px] font-medium leading-snug">
                        {parecePistolaMalConfigurada(last.text)
                            ? 'Aparecen símbolos raros donde va el guion: el lector tiene el teclado en otro idioma. Configúrelo en español o escriba el RUT.'
                            : 'Pase el carnet de nuevo o escriba el RUT.'}
                    </p>
                </div>
            )}
        </div>
    );
}
