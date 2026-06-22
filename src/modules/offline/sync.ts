'use client';

import * as React from 'react';
import { supabase } from '@/modules/core/lib/supabase';
import { offlineDb, type OutboxItem } from './db';
import { pendingItems, deleteMirror, pendingCount } from './outbox';
import { getBlob, deleteBlob } from './blob-store';
import { emitOfflineChange, onOfflineChange } from './bus';
import { isNetworkError } from './net';
import { useOnlineStatus } from '@/hooks/use-online-status';

// Sube un Blob local a Storage y asocia su URL firmada al array `photos` del
// registro (read-modify-write). Idempotente: el upload usa upsert y, si el Blob
// ya no existe, se asume subido y se omite.
async function applyPhotoUpload(item: OutboxItem): Promise<void> {
  const { table, recordId, payload, tenantId } = item;
  const p = (payload || {}) as { bucket?: string; photoId?: string; ext?: string; description?: string };
  const photoId = p.photoId!;
  const bucket = p.bucket!;
  const ext = p.ext || 'jpg';

  const rec = await getBlob(photoId);
  if (!rec) return; // ya subida o cancelada

  const path = `${tenantId}/${recordId}/${photoId}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, rec.blob, { contentType: rec.contentType, upsert: true });
  if (upErr) throw upErr;

  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 315360000);
  if (signErr) throw signErr;

  const { data: row, error: readErr } = await supabase
    .from(table)
    .select('photos')
    .eq('id', recordId)
    .single();
  if (readErr) throw readErr;

  const photos: any[] = Array.isArray((row as any)?.photos) ? (row as any).photos : [];
  const idx = photos.findIndex((ph) => ph?.id === photoId);
  if (idx >= 0) {
    photos[idx] = { ...photos[idx], url: signed.signedUrl, path };
  } else {
    photos.push({
      id: photoId,
      url: signed.signedUrl,
      path,
      description: p.description || '',
      date: new Date().toISOString(),
      userId: '',
      userName: '',
    });
  }
  // Quita las marcas locales (pending/localBlobId) antes de persistir.
  const cleaned = photos.map((ph) => {
    const { pending, localBlobId, ...rest } = ph;
    return rest;
  });

  const { error: updErr } = await supabase.from(table).update({ photos: cleaned } as never).eq('id', recordId);
  if (updErr) throw updErr;

  await deleteBlob(photoId);
}

async function applyItem(item: OutboxItem): Promise<void> {
  const { op, table, recordId, payload } = item;
  if (op === 'insert') {
    // upsert con onConflict=id → idempotente: reintentar nunca duplica.
    const { error } = await supabase.from(table).upsert(payload as never, { onConflict: 'id' });
    if (error) throw error;
  } else if (op === 'update') {
    const { error } = await supabase.from(table).update(payload as never).eq('id', recordId);
    if (error) throw error;
  } else if (op === 'upload_photo') {
    await applyPhotoUpload(item);
  } else if (op === 'delete_file') {
    const f = (payload || {}) as { bucket?: string; path?: string };
    if (f.bucket && f.path) {
      const { error } = await supabase.storage.from(f.bucket).remove([f.path]);
      if (error) throw error;
    }
  } else {
    const { error } = await supabase.from(table).delete().eq('id', recordId);
    if (error) throw error;
  }
}

let running = false;

// Drenaje propiamente dicho (asume que ya se tomó el candado).
async function drainOutbox(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;
  const items = await pendingItems();
  for (const item of items) {
    try {
      await applyItem(item);
      if (item.seq != null) await offlineDb.outbox.delete(item.seq);
      await deleteMirror(item.table, item.recordId);
      synced++;
    } catch (e) {
      if (isNetworkError(e)) break; // sigue offline: reintentar después
      if (item.seq != null) {
        await offlineDb.outbox.update(item.seq, {
          status: 'error',
          retries: (item.retries || 0) + 1,
          error: (e as { message?: string })?.message || 'Error de sincronización',
        });
      }
      failed++;
    }
  }
  if (synced > 0 || failed > 0) emitOfflineChange();
  return { synced, failed };
}

/**
 * Drena la cola FIFO contra Supabase.
 *  - Éxito → borra el item de la cola y su copia del espejo (el servidor manda).
 *  - Error de red → aborta la corrida (reintenta luego); no pierde nada.
 *  - Error de validación/permiso → marca el item con error y continúa (evita
 *    bloquear la cola para siempre); los datos siguen a salvo en local.
 *
 * Protegido por un candado entre pestañas (`navigator.locks`): si otra pestaña
 * ya está sincronizando, esta corrida se omite (evita carreras update/delete).
 */
export async function syncOutbox(): Promise<{ synced: number; failed: number }> {
  if (running) return { synced: 0, failed: 0 };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { synced: 0, failed: 0 };
  running = true;
  try {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks?.request) {
      const result = await locks.request(
        'pagnol-sync',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return { synced: 0, failed: 0 }; // otra pestaña ya sincroniza
          return drainOutbox();
        },
      );
      return result ?? { synced: 0, failed: 0 };
    }
    // Sin Web Locks API: el flag `running` por-pestaña es la única protección.
    return await drainOutbox();
  } finally {
    running = false;
  }
}

// Reintento periódico mientras haya pendientes: cubre conexiones intermitentes
// de terreno donde el evento `online` no se dispara aunque la red ya responda.
const PERIODIC_MS = 30_000;

/**
 * Arranca el sincronizador. Dispara `syncOutbox()` en varios momentos para
 * maximizar la entrega sin perder datos:
 *  - al montar y al recuperar conexión (`online`);
 *  - cuando se encola algo nuevo (bus);
 *  - al volver el foco / hacerse visible la pestaña (regreso de segundo plano);
 *  - cada 30 s mientras haya pendientes (señal intermitente).
 * Además registra Background Sync (best-effort) para que el SW reintente cuando
 * la pestaña está en segundo plano. Montar una sola vez (en el layout).
 */
export function useOfflineSync() {
  const online = useOnlineStatus();

  React.useEffect(() => {
    if (online) void syncOutbox();
  }, [online]);

  React.useEffect(() => {
    return onOfflineChange(() => {
      if (navigator.onLine) void syncOutbox();
    });
  }, []);

  React.useEffect(() => {
    const tryNow = () => {
      if (navigator.onLine) void syncOutbox();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tryNow();
    };
    window.addEventListener('focus', tryNow);
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(async () => {
      if (navigator.onLine && (await pendingCount()) > 0) void syncOutbox();
    }, PERIODIC_MS);
    return () => {
      window.removeEventListener('focus', tryNow);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, []);

  // Background Sync (best-effort): el SW pedirá a las pestañas abiertas que
  // sincronicen al recuperar conexión en segundo plano.
  React.useEffect(() => {
    void (async () => {
      try {
        const reg = await navigator.serviceWorker?.ready;
        await (reg as unknown as { sync?: { register: (t: string) => Promise<void> } })?.sync?.register(
          'pagnol-sync',
        );
      } catch {
        /* navegador sin Background Sync: los demás disparadores cubren el caso */
      }
    })();

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'pagnol-sync' && navigator.onLine) void syncOutbox();
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
}
