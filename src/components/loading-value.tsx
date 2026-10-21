'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppIsLoading } from '@/modules/data/DataProvider';

interface LoadingValueProps {
    children: React.ReactNode;
    /** Tamaño del esqueleto; debe parecerse al valor real para que no salte el layout. */
    className?: string;
}

/**
 * Cifra o contador que depende del estado global. Mientras éste carga muestra un
 * esqueleto en vez del valor: un «0» o un «$0» en un KPI se lee como dato real
 * (ADR-014: «cargando» y «vacío» no pueden verse igual), y con mala señal el
 * usuario llegaba a creer que el stock se había perdido.
 */
export function LoadingValue({ children, className }: LoadingValueProps) {
    const loading = useAppIsLoading();
    if (loading) return <Skeleton aria-hidden className={cn('inline-block h-[1em] w-12 align-middle', className)} />;
    return <>{children}</>;
}
