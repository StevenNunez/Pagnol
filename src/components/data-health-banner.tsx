'use client';

import { AlertTriangle, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { requestResync, useDataHealth } from '@/modules/core/lib/data-health';

/**
 * Avisa cuando los datos en pantalla pueden estar desactualizados: una carga
 * falló (se muestra lo último bueno) o la conexión en vivo está caída. Antes
 * esto ocurría en silencio y una solicitud nueva simplemente «no aparecía».
 */
export function DataHealthBanner() {
    const { failed, realtimeDown } = useDataHealth();
    if (failed.length === 0 && realtimeDown.length === 0) return null;

    const hasFailed = failed.length > 0;
    const Icon = hasFailed ? AlertTriangle : WifiOff;
    return (
        <div
            role="status"
            className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-warning bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-foreground sm:mx-6 lg:mx-10"
        >
            <Icon className="h-4 w-4 shrink-0" />
            <p className="flex-1 font-medium">
                {hasFailed
                    ? 'No se pudieron actualizar algunos datos. Estás viendo lo último que se cargó.'
                    : 'Sin conexión en vivo: los cambios de otros usuarios pueden tardar en aparecer. Se actualizará al volver la señal.'}
            </p>
            <Button size="sm" variant="outline" className="rounded-xl" onClick={() => requestResync(true)}>Reintentar</Button>
        </div>
    );
}
