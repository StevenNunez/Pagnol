"use client";

import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { X } from 'lucide-react';
import type { Material } from '@/modules/core/lib/data';

/**
 * Contenedor de los selectores de material. En escritorio es un popover bajo
 * el botón; en el celular, un popover del ancho del botón quedaba como una
 * cajita de 5 filas, tapada por el teclado y los botones flotantes, con los
 * nombres cortados. Ahí se abre a pantalla completa: buscador arriba (siempre
 * visible sobre el teclado) y la lista ocupando el resto.
 */

const PHONE_QUERY = '(max-width: 639px)';

export function useIsPhone(): boolean {
    const [isPhone, setIsPhone] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(PHONE_QUERY);
        const update = () => setIsPhone(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    return isPhone;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Búsqueda por palabras: sin tildes ni mayúsculas, y TODAS las palabras deben
 * aparecer (en nombre, código interno, marca o categoría). El filtro difuso de
 * cmdk encontraba "guan" dentro de "zapato de seGUridAd caN…" y llenaba la
 * lista de resultados sin relación en un catálogo de cientos de ítems.
 */
export function filterMaterials(groups: Record<string, Material[]>, query: string): Record<string, Material[]> {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length) return groups;
    const out: Record<string, Material[]> = {};
    for (const [category, items] of Object.entries(groups)) {
        const hits = items.filter((m) => {
            const hay = normalize(`${m.name} ${m.internalCode ?? ''} ${m.brand ?? ''} ${category}`);
            return words.every((w) => hay.includes(w));
        });
        if (hits.length) out[category] = hits;
    }
    return out;
}

interface MaterialPickerShellProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trigger: React.ReactNode;
    /** Título de la vista a pantalla completa (celular). */
    title: string;
    children: React.ReactNode;
}

export function MaterialPickerShell({ open, onOpenChange, trigger, title, children }: MaterialPickerShellProps) {
    const isPhone = useIsPhone();

    if (isPhone) {
        return (
            <>
                <span onClick={() => onOpenChange(true)} className="contents">{trigger}</span>
                <Dialog open={open} onOpenChange={onOpenChange}>
                    <DialogContent
                        hideClose
                        aria-describedby={undefined}
                        className="inset-0 left-0 top-0 translate-x-0 translate-y-0 max-w-none w-full h-[100dvh] p-0 gap-0 rounded-none border-0 flex flex-col data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0 data-[state=closed]:slide-out-to-left-0 data-[state=closed]:slide-out-to-top-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100"
                    >
                        <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2 shrink-0">
                            <DialogTitle className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{title}</DialogTitle>
                            <button
                                type="button"
                                onClick={() => onOpenChange(false)}
                                className="p-2 -mr-2 rounded-xl text-muted-foreground hover:text-foreground"
                                aria-label="Cerrar"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
                    </DialogContent>
                </Dialog>
            </>
        );
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent className="w-[max(var(--radix-popover-trigger-width),28rem)] max-w-[calc(100vw-2rem)] p-0 rounded-xl" align="start">
                {children}
            </PopoverContent>
        </Popover>
    );
}

/** Clases de CommandList: en el celular llena la pantalla; en escritorio, tope de alto. */
export const pickerListClass = (isPhone: boolean) =>
    isPhone ? 'max-h-none flex-1 min-h-0 overscroll-contain pb-28' : 'max-h-[min(420px,60vh)]';
