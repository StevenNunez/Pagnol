'use client';

import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { cn } from '@/lib/utils';

interface PageShellProps {
    title: string;
    description?: string;
    /**
     * Fila estándar de toolbar (filtros / búsqueda / acción primaria).
     * Se renderiza con el layout canónico: flex que separa izquierda y derecha
     * y colapsa en vertical en pantallas chicas.
     */
    toolbar?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

/**
 * Layout maestro de página del dashboard. Estandariza el wrapper (espaciado +
 * animación de entrada) y el título (vía PageHeader, que alimenta la barra
 * superior). Toda página de `/dashboard` debería envolverse en esto.
 *
 * @example
 * <PageShell title="Gestión de Activos" description="…" toolbar={<MisFiltros/>}>
 *   <DataTable … />
 * </PageShell>
 */
export function PageShell({ title, description, toolbar, children, className }: PageShellProps) {
    return (
        <div className={cn('space-y-8 animate-in fade-in duration-500', className)}>
            <PageHeader title={title} description={description} />
            {toolbar && (
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
                    {toolbar}
                </div>
            )}
            {children}
        </div>
    );
}
