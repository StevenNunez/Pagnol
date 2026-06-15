'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
    /** Ícono (p. ej. `<Box size={24} />`). Opcional. */
    icon?: React.ReactNode;
    title: string;
    description?: string;
    /** Acción opcional (p. ej. un `<Button>` para crear el primer registro). */
    action?: React.ReactNode;
    className?: string;
}

/**
 * Estado vacío estándar. Reemplaza los bloques "No hay datos" hechos a mano en
 * cada página. Usa solo tokens (dark-mode safe) y el radio de marca Pagnol.
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-dashed bg-card px-6 py-16 text-center',
                className,
            )}
        >
            {icon && (
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                    {icon}
                </div>
            )}
            <div className="space-y-1">
                <p className="text-base font-bold text-foreground">{title}</p>
                {description && (
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
                )}
            </div>
            {action}
        </div>
    );
}
