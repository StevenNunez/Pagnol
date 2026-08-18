'use client';

import * as React from 'react';
import { CONTRACTS_BUCKET, getSignedUrl } from '@/modules/core/lib/storage';
import { useToast } from '@/modules/core/hooks/use-toast';
import { cn } from '@/lib/utils';

// Enlace a un archivo del bucket privado `contracts` (P0 de seguridad).
//
// Reemplaza a `<a href={url} target="_blank">` sobre URLs públicas. La URL se
// firma EN EL CLIC y no se guarda en ninguna parte: una firmada expira, así que
// persistirla la dejaría muerta a los minutos.
//
// Acepta tanto el path nuevo como la URL pública que guardaban las filas
// antiguas — no hay que migrar datos para que esto funcione.

interface SecureFileLinkProps {
    /** Path en el bucket, o la URL pública guardada por una fila antigua. */
    stored: string | null | undefined;
    children: React.ReactNode;
    className?: string;
    /** Cuánto vive la URL firmada. Por defecto 5 minutos. */
    expiresIn?: number;
    /**
     * Bucket donde vive el archivo. Por defecto `contracts`, que es de donde
     * salió este componente; `hr-documents` y `supplier-documents` lo usan
     * también desde que dejaron de persistir su URL firmada.
     */
    bucket?: string;
}

export function SecureFileLink({ stored, children, className, expiresIn, bucket }: SecureFileLinkProps) {
    const { toast } = useToast();
    const [loading, setLoading] = React.useState(false);

    const abrir = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (loading) return;
        setLoading(true);
        try {
            const url = await getSignedUrl(bucket ?? CONTRACTS_BUCKET, stored, expiresIn);
            if (!url) {
                toast({
                    variant: 'destructive',
                    title: 'No se pudo abrir el documento',
                    description: 'El archivo no está disponible o no tienes acceso.',
                });
                return;
            }
            window.open(url, '_blank', 'noopener,noreferrer');
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={abrir}
            disabled={loading}
            className={cn('cursor-pointer disabled:opacity-60', className)}
        >
            {children}
        </button>
    );
}
