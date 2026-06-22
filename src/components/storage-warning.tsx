'use client';

import { AlertTriangle } from 'lucide-react';
import { useStorageWarning } from '@/modules/offline/use-storage-warning';

/**
 * Banner que aparece solo cuando el almacenamiento local está casi lleno, para
 * que el usuario sincronice (y libere espacio) antes de que falle un guardado.
 */
export function StorageWarning() {
  const info = useStorageWarning();
  if (!info?.low) return null;

  return (
    <div className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-warning-subtle-foreground sm:mx-6 lg:mx-10">
      <AlertTriangle className="h-5 w-5 shrink-0" />
      <div className="text-sm">
        <p className="font-bold">Almacenamiento casi lleno</p>
        <p className="text-xs">
          Usado {Math.round(info.usedMB)} MB de {Math.round(info.quotaMB)} MB. Conéctate a internet
          para sincronizar tus cambios y liberar espacio antes de seguir capturando.
        </p>
      </div>
    </div>
  );
}
