'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadingStateProps {
    label?: string;
    /** Ocupa alto de viewport — para páginas/áreas completas en carga. */
    fullHeight?: boolean;
    className?: string;
    /** Botón opcional (p. ej. «Reintentar» cuando la carga tarda demasiado). */
    action?: React.ReactNode;
}

/**
 * Estado de carga estándar. Reemplaza los spinners `Loader2` copiados a mano en
 * cada página. Spinner en color de marca (`primary`), accesible (`role=status`).
 */
export function LoadingState({ label = 'Cargando…', fullHeight, className, action }: LoadingStateProps) {
    return (
        <div
            role="status"
            aria-live="polite"
            className={cn(
                'flex flex-col items-center justify-center gap-4 text-center',
                fullHeight ? 'min-h-[60vh]' : 'py-16',
                className,
            )}
        >
            <Loader2 className="h-9 w-9 animate-spin text-primary" />
            {label && <p className="text-sm font-medium text-muted-foreground">{label}</p>}
            {action}
        </div>
    );
}
