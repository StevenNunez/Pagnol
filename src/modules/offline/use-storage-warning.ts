'use client';

import * as React from 'react';
import { onOfflineChange } from './bus';

export interface StorageInfo {
  low: boolean;
  usedMB: number;
  quotaMB: number;
  percent: number;
}

const LOW_PERCENT = 0.85;
const LOW_FREE_BYTES = 50 * 1024 * 1024; // 50 MB

/**
 * Monitorea el almacenamiento local (IndexedDB + caché). Marca `low` cuando se
 * supera el 85% de la cuota o quedan menos de ~50 MB libres — relevante para
 * técnicos que acumulan fotos varios días sin conexión.
 */
export function useStorageWarning(): StorageInfo | null {
  const [info, setInfo] = React.useState<StorageInfo | null>(null);

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return;
    let alive = true;
    const check = async () => {
      try {
        const { usage = 0, quota = 0 } = await navigator.storage.estimate();
        const percent = quota > 0 ? usage / quota : 0;
        const low = quota > 0 && (percent > LOW_PERCENT || quota - usage < LOW_FREE_BYTES);
        if (alive) {
          setInfo({ low, usedMB: usage / 1e6, quotaMB: quota / 1e6, percent });
        }
      } catch {
        /* noop */
      }
    };
    void check();
    const off = onOfflineChange(check); // recheck al escribir blobs/cola
    const id = setInterval(check, 60_000);
    return () => {
      alive = false;
      off();
      clearInterval(id);
    };
  }, []);

  return info;
}
