'use client';

import * as React from 'react';
import { toast } from '@/modules/core/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

/**
 * Registra el Service Worker y avisa cuando hay una versión nueva en espera.
 * El SW no se auto-activa (no usa skipWaiting en install); aquí mostramos un
 * toast "Nueva versión disponible" con acción "Actualizar", que envía
 * SKIP_WAITING al SW en espera y recarga al tomar control.
 */
export function ServiceWorkerUpdater() {
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const promptUpdate = (worker: ServiceWorker) => {
      toast({
        title: 'Nueva versión disponible',
        description: 'Actualiza para obtener las últimas mejoras.',
        duration: 1000 * 60 * 60, // persiste hasta que el usuario actúe
        action: (
          <ToastAction altText="Actualizar" onClick={() => worker.postMessage({ type: 'SKIP_WAITING' })}>
            Actualizar
          </ToastAction>
        ),
      });
    };

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            // Solo avisamos si ya había un SW controlando (es una ACTUALIZACIÓN,
            // no la primera instalación).
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdate(nw);
            }
          });
        });
      })
      .catch(console.error);

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  return null;
}
