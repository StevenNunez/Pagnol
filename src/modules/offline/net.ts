'use client';

/**
 * ¿El fallo se debe a falta de conexión? (vs. un error de validación/permiso).
 * Se usa para decidir si una mutación debe encolarse en el outbox.
 */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const msg = (e as { message?: string })?.message?.toLowerCase() || '';
  return (
    e instanceof TypeError ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed')
  );
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}
