'use client';
import { useState, useEffect, useCallback } from 'react';

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
    if (!userId || !tenantId) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!VAPID_PUBLIC_KEY) {
      console.error('[Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY no está definida. Reinicia el servidor tras agregarla a .env.local.');
      return false;
    }

    setIsLoading(true);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm as PushPermission);
      if (perm !== 'granted') return false;

      const reg = await navigator.serviceWorker.ready;

      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        await existingSub.unsubscribe();
        // Pausa breve para que el servicio de push procese la desuscripción
        await new Promise((r) => setTimeout(r, 600));
      }

      const subscription = await subscribeToPush(reg, VAPID_PUBLIC_KEY);

      const subJson = subscription.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription: { endpoint: subJson.endpoint, keys: subJson.keys },
          userId,
          tenantId,
        }),
      });

      setIsSubscribed(true);
      return true;
    } catch (err: any) {
      // AbortError del servicio push es transitorio — no bloquea la app
      if (err?.name === 'AbortError') {
        console.warn('[Push] El servicio de notificaciones push no está disponible temporalmente. Intenta de nuevo más tarde.');
      } else {
        console.error('[Push] Error al suscribirse:', err?.name, err?.message);
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
