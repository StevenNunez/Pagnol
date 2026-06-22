'use client';

import { useSyncExternalStore } from 'react';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

// En SSR asumimos conexión para evitar parpadeo de "sin conexión" en la
// primera pintura (el navegador corrige al hidratar).
function getServerSnapshot() {
  return true;
}

/**
 * Estado de conexión del dispositivo, reactivo a los eventos `online`/`offline`
 * del navegador. Base para los indicadores visuales de sincronización.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
