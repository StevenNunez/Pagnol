'use client';

import * as React from 'react';
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from '@/components/ui/table';
import { LoadingState } from '@/components/loading-state';
import { EmptyState } from '@/components/empty-state';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T> {
    /** Clave única de la columna (para React key). */
    key: string;
    header: React.ReactNode;
    /** Render de la celda para una fila. */
    cell: (row: T) => React.ReactNode;
    className?: string;
    headerClassName?: string;
}

interface DataTableProps<T> {
    columns: DataTableColumn<T>[];
    data: T[];
    /** Devuelve la key estable de cada fila. */
    rowKey: (row: T) => string;
    isLoading?: boolean;
    onRowClick?: (row: T) => void;
    /** Texto del estado vacío. */
    empty?: { icon?: React.ReactNode; title: string; description?: string };
    /** Alto máximo (p. ej. '500px'): scroll interno con cabecera sticky. */
    maxHeight?: string;
    /** Ancho mínimo de la tabla (p. ej. '700px') para scroll horizontal. */
    minWidth?: string;
    className?: string;
}

/**
 * Tabla estándar: envuelve el primitivo `ui/table` en una Card con el radio de
 * marca, cabeceras con micro-label, y estados de carga/vacío integrados
 * (LoadingState / EmptyState). Reemplaza las tablas ad-hoc por página.
 */
export function DataTable<T>({
    columns,
    data,
    rowKey,
    isLoading,
    onRowClick,
    empty,
    maxHeight,
    minWidth,
    className,
}: DataTableProps<T>) {
    return (
        <div className={cn('overflow-hidden rounded-[1.5rem] border bg-card shadow-sm', className)}>
            {isLoading ? (
                <LoadingState />
            ) : data.length === 0 ? (
                <EmptyState
                    className="border-0"
                    icon={empty?.icon}
                    title={empty?.title ?? 'Sin datos'}
                    description={empty?.description}
                />
            ) : (
                <div className="overflow-auto no-scrollbar" style={maxHeight ? { maxHeight } : undefined}>
                    <Table style={minWidth ? { minWidth } : undefined}>
                        <TableHeader
                            className={cn(maxHeight && 'sticky top-0 z-10 bg-muted/80 backdrop-blur-sm')}
                        >
                            <TableRow>
                                {columns.map((col) => (
                                    <TableHead
                                        key={col.key}
                                        className={cn(
                                            'text-[10px] font-black uppercase tracking-widest',
                                            col.headerClassName,
                                        )}
                                    >
                                        {col.header}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((row) => (
                                <TableRow
                                    key={rowKey(row)}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={onRowClick ? 'cursor-pointer' : undefined}
                                >
                                    {columns.map((col) => (
                                        <TableCell key={col.key} className={col.className}>
                                            {col.cell(row)}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
}
