'use client';

/**
 * Bus de cambios offline: notifica a los hooks de lectura (mirror/outbox) que
 * algo cambió localmente (encolado, sincronizado, error) para que re-consulten
 * IndexedDB sin acoplarnos a `dexie-react-hooks`.
 */
const target = typeof window !== 'undefined' ? new EventTarget() : null;
const EVENT = 'pagnol-offline-change';

export function emitOfflineChange() {
  target?.dispatchEvent(new Event(EVENT));
}

export function onOfflineChange(cb: () => void): () => void {
  if (!target) return () => {};
  target.addEventListener(EVENT, cb);
  return () => target.removeEventListener(EVENT, cb);
}
