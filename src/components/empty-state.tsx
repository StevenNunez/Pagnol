'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useAppIsLoading } from '@/modules/data/DataProvider';
import { LoadingState } from '@/components/loading-state';
import { useDataHealth, requestResync } from '@/modules/core/lib/data-health';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface EmptyStateProps {
    /** Ícono (p. ej. `<Box size={24} />`). Opcional. */
    icon?: React.ReactNode;
    title: string;
    description?: string;
    /** Acción opcional (p. ej. un `<Button>` para crear el primer registro). */
    action?: React.ReactNode;
    className?: string;
    /**
     * Pinta el vacío aunque el estado global aún esté cargando. Sólo para listas
     * que NO salen de `useAppState()` (filtros locales, datos propios del
     * componente), donde "cargando" no aplica.
     */
    ignoreAppLoading?: boolean;
}

/**
 * Estado vacío estándar. Reemplaza los bloques "No hay datos" hechos a mano en
 * cada página. Usa solo tokens (dark-mode safe) y el radio de marca Pagnol.
 *
 * **Mientras el estado global carga, muestra el spinner en vez del vacío**
 * (ADR-014): "todavía no llegaron los datos" y "no hay datos" se ven idénticos
 * —una lista vacía— y afirmar lo segundo es mentir la mitad de las veces. En
 * faena con mala señal, un "No hay existencias" se lee como "perdimos el stock".
 * Se resuelve aquí, y no en cada página, porque son 54 las que pintan vacíos y
 * `DataTable` delega su estado vacío en este mismo componente.
 */
export function EmptyState({ icon, title, description, action, className, ignoreAppLoading }: EmptyStateProps) {
    const appIsLoading = useAppIsLoading();
    const health = useDataHealth();
    if (appIsLoading && !ignoreAppLoading) {
        return health.slow ? (
            <LoadingState
                className={className}
                label="Esto está tardando más de lo normal. Revisa tu señal; seguimos intentando."
                action={<Button variant="outline" className="rounded-xl" onClick={() => requestResync(true)}>Reintentar ahora</Button>}
            />
        ) : <LoadingState className={className} />;
    }
    // Una carga que falló o se dio por vencida NO es «no hay datos»: afirmarlo
    // haría creer que se perdió información.
    if (!ignoreAppLoading && (health.failed.length > 0 || health.gaveUp)) {
        return (
            <div
                role="alert"
                className={cn('flex flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-dashed border-warning bg-card px-6 py-16 text-center', className)}
            >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning-subtle text-warning-subtle-foreground">
                    <AlertTriangle size={24} />
                </div>
                <div className="space-y-1">
                    <p className="text-base font-bold text-foreground">No se pudieron cargar los datos</p>
                    <p className="mx-auto max-w-sm text-sm text-muted-foreground">Es un problema de conexión, no de información perdida. Intenta de nuevo.</p>
                </div>
                <Button className="rounded-xl" onClick={() => requestResync(true)}>Reintentar</Button>
            </div>
        );
    }

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
