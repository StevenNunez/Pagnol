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
    /** Render de la celda. `index` es la posición en `data` (para rankings "#"). */
    cell: (row: T, index: number) => React.ReactNode;
    className?: string;
    headerClassName?: string;
}

interface DataTableProps<T> {
    columns: DataTableColumn<T>[];
    data: T[];
    /**
     * Key estable de cada fila. Recibe el índice porque no toda colección trae id
     * propio (los ítems de una OC, p. ej., pueden repetir nombre).
     */
    rowKey: (row: T, index: number) => string;
    isLoading?: boolean;
    /** Texto del estado de carga (por defecto el genérico de LoadingState). */
    loadingLabel?: string;
    onRowClick?: (row: T) => void;
    /** Clases extra por fila (p. ej. atenuar las ya procesadas). */
    rowClassName?: (row: T) => string | undefined;
    /** Estado vacío. `action` permite ofrecer una salida (p. ej. "crear el primero"). */
    empty?: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode };
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
    loadingLabel,
    onRowClick,
    rowClassName,
    empty,
    maxHeight,
    minWidth,
    className,
}: DataTableProps<T>) {
    return (
        <div className={cn('overflow-hidden rounded-[1.5rem] border bg-card shadow-sm', className)}>
            {isLoading ? (
                <LoadingState label={loadingLabel} />
            ) : data.length === 0 ? (
                <EmptyState
                    className="border-0"
                    icon={empty?.icon}
                    title={empty?.title ?? 'Sin datos'}
                    description={empty?.description}
                    action={empty?.action}
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
                            {data.map((row, index) => (
                                <TableRow
                                    key={rowKey(row, index)}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                    className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
                                >
                                    {columns.map((col) => (
                                        <TableCell key={col.key} className={col.className}>
                                            {col.cell(row, index)}
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
