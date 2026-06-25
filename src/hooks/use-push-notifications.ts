'use client';
import { useState, useEffect, useCallback } from 'react';
import { toast } from '@/modules/core/hooks/use-toast';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

async function subscribeToPush(
  reg: ServiceWorkerRegistration,
  vapidKey: string,
  maxAttempts = 3
): Promise<PushSubscription> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    } catch (err: any) {
      lastErr = err;
      const isTransient = err?.name === 'AbortError' || err?.name === 'NetworkError';
      if (isTransient && attempt < maxAttempts) {
        const delay = attempt * 2000;
        console.warn(`[Push] Servicio no disponible (intento ${attempt}/${maxAttempts}), reintentando en ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        break;
      }
    }
  }
  throw lastErr;
}

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function usePushNotifications(userId?: string, tenantId?: string) {
  const [permission, setPermission] = useState<PushPermission>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as PushPermission);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          setIsSubscribed(!!sub);
        });
      });
    }
  }, []);

  const subscribe = useCallback(async (): Promise<boolean> => {
    // Antes esta función fallaba en SILENCIO en cada rama (return false sin avisar),
    // así que el usuario "daba clic y no pasaba nada". Ahora cada caso da feedback.
    if (!userId || !tenantId) {
      toast({ variant: 'destructive', title: 'Sesión no lista', description: 'Vuelve a intentarlo en unos segundos.' });
      return false;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      toast({ variant: 'destructive', title: 'Navegador sin soporte', description: 'Este navegador no soporta notificaciones push (usa Chrome/Edge/Firefox en HTTPS).' });
      return false;
    }

    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC_KEY) {
      toast({ variant: 'destructive', title: 'Push sin configurar', description: 'Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY. Reinicia el servidor tras agregarla a .env.local.' });
      return false;
    }

    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm === 'denied') {
        toast({ variant: 'destructive', title: 'Notificaciones bloqueadas', description: 'Habilítalas para este sitio en la barra de direcciones del navegador (icono 🔒 → Notificaciones).' });
        return false;
      }
      if (perm !== 'granted') {
        toast({ title: 'Permiso pendiente', description: 'No se concedió el permiso de notificaciones.' });
        return false;
      }

      const reg = await navigator.serviceWorker.ready;

      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
        // Pausa breve para que el servicio de push procese la desuscripción
        await new Promise((r) => setTimeout(r, 600));
      }

      const subscription = await subscribeToPush(reg, VAPID_PUBLIC_KEY);

      const subJson = subscription.toJSON();
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: { endpoint: subJson.endpoint, keys: subJson.keys },
          userId,
          tenantId,
        }),
      });

      // Verificar que el servidor guardó la suscripción. Si la tabla
      // push_subscriptions no existe, esto devuelve 500 y NO debemos
      // marcar como suscrito (si no, "queda suscrito" pero nunca llega nada).
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { detail = (await res.json())?.error || detail; } catch { /* ignore */ }
        toast({ variant: 'destructive', title: 'No se pudo registrar la suscripción', description: detail });
        return false;
      }

      setIsSubscribed(true);
      toast({ variant: 'success', title: 'Notificaciones push activadas', description: 'Las recibirás aunque la app esté cerrada.' });
      return true;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        toast({ variant: 'destructive', title: 'Servicio push no disponible', description: 'El navegador no pudo contactar su servicio de push. Suele pasar con Brave o con VPN/firewall corporativo que bloquean FCM. Prueba en Chrome/Edge sin VPN, o en el sitio publicado (HTTPS).' });
      } else {
        toast({ variant: 'destructive', title: 'Error al activar push', description: err?.message || 'Error desconocido.' });
      }
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [userId, tenantId]);

  const unsubscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return;
    setIsLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
        setIsSubscribed(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { permission, isSubscribed, isLoading, subscribe, unsubscribe };
}
