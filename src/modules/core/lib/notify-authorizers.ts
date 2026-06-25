import { supabase } from './supabase';

/**
 * Dispara (fire-and-forget) un push a los autorizadores del tenant cuando se
 * crea una solicitud que requiere autorización del ADC. NO se await: un fallo de
 * notificación nunca debe romper la creación de la solicitud.
 */
export function notifyAuthorizers(
  type: 'material' | 'purchase' | 'rental',
  opts: { tenantId: string; code?: string; requesterName?: string },
): void {
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch('/api/push/notify-authorizers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, tenantId: opts.tenantId, code: opts.code, requesterName: opts.requesterName }),
      });
    } catch {
      /* fire-and-forget: silenciar errores de notificación */
    }
  })();
}
