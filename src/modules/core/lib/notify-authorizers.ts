import { supabase } from './supabase';

/**
 * Dispara (fire-and-forget) un push a los autorizadores del tenant cuando se
 * crea una solicitud que requiere autorización del ADC. NO se await: un fallo de
 * notificación nunca debe romper la creación de la solicitud.
 */
export function notifyAuthorizers(
  type: 'material' | 'purchase' | 'rental' | 'purchase_review' | 'rental_review' | 'proposal_gerente',
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

/**
 * Avisos del recorrido de un retiro del pañol (fire-and-forget, como `notifyAuthorizers`):
 *  · `authorized`: el ADC lo autorizó → le toca al pañol aprobarlo;
 *  · `approved`: el pañol aprobó el despacho → el solicitante ya puede ir a retirarlo;
 *  · `cancelled`: se anuló el despacho aprobado → el solicitante sabe que no lo retire.
 * Sin estos avisos un retiro podía quedar horas esperando sin que nadie supiera que le tocaba.
 * El servidor decide a quién avisar leyendo el retiro; aquí sólo se manda su id y el evento.
 */
export function notifyWithdrawal(event: 'authorized' | 'approved' | 'cancelled', requestId: string): void {
  void (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch('/api/push/notify-withdrawal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event, requestId }),
      });
    } catch {
      /* fire-and-forget: silenciar errores de notificación */
    }
  })();
}
