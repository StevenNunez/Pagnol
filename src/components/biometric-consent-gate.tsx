'use client';

import React, { useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { consentParagraphs } from '@/modules/core/lib/biometric-consent';
import { cn } from '@/lib/utils';

/**
 * Pantalla de consentimiento que antecede a CUALQUIER captura biométrica.
 *
 * Se usa igual en el teléfono del trabajador (`/enroll/[token]`, tema oscuro
 * fijo) y en el asistente del computador (fondo blanco), por eso el `tone`: el
 * texto y el gesto de aceptar tienen que ser los mismos en los dos caminos, y
 * lo único que cambia es sobre qué fondo se pinta.
 *
 * El botón sólo se habilita con el check marcado. Es deliberadamente un paso
 * más, no una casilla premarcada: un consentimiento por defecto no es
 * consentimiento.
 */
export function BiometricConsentGate({
    empresa,
    tone = 'light',
    saving = false,
    onAccept,
    onDecline,
}: {
    empresa: string;
    tone?: 'light' | 'dark';
    saving?: boolean;
    onAccept: () => void;
    onDecline?: () => void;
}) {
    const [checked, setChecked] = useState(false);
    const dark = tone === 'dark';
    const parrafos = consentParagraphs(empresa);

    return (
        <div className={cn('flex flex-col gap-5', dark ? 'flex-1' : 'p-8')}>
            <div className="flex items-start gap-3">
                <div className={cn(
                    'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
                    dark ? 'bg-white/10 text-pagnol-orange' : 'bg-primary/10 text-primary',
                )}>
                    <ShieldCheck size={20} />
                </div>
                <div>
                    <p className={cn(
                        'text-[10px] font-black uppercase tracking-[0.2em]',
                        dark ? 'text-white/40' : 'text-slate-400',
                    )}>
                        Antes de empezar
                    </p>
                    <h2 className={cn(
                        'text-lg font-black uppercase tracking-tight',
                        dark ? 'text-white' : 'text-slate-900',
                    )}>
                        Autorización de datos biométricos
                    </h2>
                </div>
            </div>

            <div className={cn(
                'rounded-[1.5rem] border p-5 space-y-3 overflow-y-auto text-sm leading-relaxed',
                dark
                    ? 'bg-white/5 border-white/10 text-white/70 max-h-[45vh]'
                    : 'bg-slate-50 border-slate-200 text-slate-600 max-h-[38vh]',
            )}>
                {parrafos.map((p, i) => (
                    <p key={i}>{p}</p>
                ))}
            </div>

            <label className={cn(
                'flex items-start gap-3 cursor-pointer rounded-2xl border p-4 transition-colors',
                dark
                    ? checked ? 'border-pagnol-orange/50 bg-pagnol-orange/10' : 'border-white/10 bg-white/5'
                    : checked ? 'border-primary/50 bg-primary/5' : 'border-slate-200 bg-white',
            )}>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => setChecked(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-current cursor-pointer"
                />
                <span className={cn('text-sm font-bold', dark ? 'text-white' : 'text-slate-800')}>
                    He leído y acepto el tratamiento de mis datos biométricos en los términos descritos.
                </span>
            </label>

            <div className="flex flex-col gap-3">
                <button
                    onClick={onAccept}
                    disabled={!checked || saving}
                    className={cn(
                        'h-14 rounded-2xl font-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed',
                        dark ? 'bg-pagnol-orange text-white' : 'bg-primary text-primary-foreground',
                    )}
                >
                    {saving ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                    Acepto y continúo
                </button>
                {onDecline && (
                    <button
                        onClick={onDecline}
                        disabled={saving}
                        className={cn(
                            'text-[10px] font-bold uppercase tracking-widest transition-colors',
                            dark ? 'text-white/40 hover:text-white/70' : 'text-slate-400 hover:text-slate-600',
                        )}
                    >
                        No acepto
                    </button>
                )}
            </div>
        </div>
    );
}
