'use client';

import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ErrorPanelProps {
    title?: string;
    description?: string;
    onRetry?: () => void;
    /** Detalle técnico para soporte (el `digest` de Next); se muestra pequeño. */
    reference?: string;
    action?: React.ReactNode;
    className?: string;
}

/**
 * Pantalla de error estándar para los límites de Next (`error.tsx`). Sin lenguaje
 * técnico: dice qué pasó, que los datos no se perdieron y qué hacer.
 */
export function ErrorPanel({
    title = 'Algo salió mal en esta pantalla',
    description = 'Tus datos están a salvo. Intenta de nuevo; si sigue pasando, avisa a soporte.',
    onRetry,
    reference,
    action,
    className,
}: ErrorPanelProps) {
    return (
        <div
            role="alert"
            className={cn('flex flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-dashed bg-card px-6 py-16 text-center', className)}
        >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertTriangle size={24} />
            </div>
            <div className="space-y-1">
                <p className="text-base font-bold text-foreground">{title}</p>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
                {reference && <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ref. {reference}</p>}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
                {onRetry && <Button className="rounded-xl" onClick={onRetry}>Reintentar</Button>}
                {action}
            </div>
        </div>
    );
}
