'use client';

import * as React from 'react';
import { offlineDb, draftKey, requestPersistentStorage, type DraftRecord } from './db';

interface Options {
  entity: string;
  entityId: string | undefined;
  tenantId: string | undefined;
  /** Desactiva la persistencia (p. ej. sin permiso de edición). */
  enabled?: boolean;
  /** ms de espera antes de escribir tras el último cambio. */
  debounceMs?: number;
}

interface DraftMeta {
  dirty: boolean;
  updatedAt: number;
  error?: string;
}

/**
 * Autosave + restauración de un borrador en IndexedDB.
 *
 * No es dueño del estado del formulario: la página mantiene su `draft` en
 * useState y solo llama a `save(data)` en cada cambio. Esta capa se encarga de
 * escribir (con debounce) en local, marcar `dirty`, y exponer el meta para los
 * indicadores de UI. `markSynced()` se llama tras guardar con éxito en Supabase.
 */
export function useOfflineDraft<T>({
  entity,
  entityId,
  tenantId,
  enabled = true,
  debounceMs = 600,
}: Options) {
  const key = entityId ? draftKey(entity, entityId) : undefined;
  const [meta, setMeta] = React.useState<DraftMeta | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = React.useRef<T | null>(null);

  // Pide almacenamiento persistente una sola vez por sesión.
  React.useEffect(() => {
    if (enabled) void requestPersistentStorage();
  }, [enabled]);

  const writeNow = React.useCallback(async () => {
    if (!key || !entityId || !tenantId || latest.current == null) return;
    const record: DraftRecord = {
      key,
      entity,
      entityId,
      tenantId,
      data: latest.current,
      updatedAt: Date.now(),
      dirty: true,
    };
    try {
      await offlineDb.drafts.put(record);
      setMeta({ dirty: true, updatedAt: record.updatedAt });
    } catch (e) {
      console.error('[offline-draft] write failed', e);
    }
  }, [key, entity, entityId, tenantId]);

  /** Programa una escritura con debounce con los últimos datos del formulario. */
  const save = React.useCallback(
    (data: T) => {
      if (!enabled || !key) return;
      latest.current = data;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void writeNow(), debounceMs);
    },
    [enabled, key, debounceMs, writeNow],
  );

  /** Fuerza la escritura inmediata (al ocultar/cerrar la pestaña). */
  const flush = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void writeNow();
  }, [writeNow]);

  /** Lee el borrador local guardado (si existe). La página decide si restaurar. */
  const load = React.useCallback(async (): Promise<DraftRecord | undefined> => {
    if (!key) return undefined;
    try {
      return await offlineDb.drafts.get(key);
    } catch {
      return undefined;
    }
  }, [key]);

  /** Marca el borrador como sincronizado tras un guardado exitoso en el servidor. */
  const markSynced = React.useCallback(async () => {
    if (!key) return;
    try {
      await offlineDb.drafts.where('key').equals(key).modify({ dirty: false, error: undefined });
      setMeta((m) => (m ? { ...m, dirty: false, error: undefined } : m));
    } catch (e) {
      console.error('[offline-draft] markSynced failed', e);
    }
  }, [key]);

  /** Marca un error de sincronización (los datos siguen a salvo en local). */
  const markError = React.useCallback(async (message: string) => {
    if (!key) return;
    try {
      await offlineDb.drafts.where('key').equals(key).modify({ error: message });
      setMeta((m) => (m ? { ...m, error: message } : m));
    } catch {
      /* noop */
    }
  }, [key]);

  /** Borra el borrador local (al descartar o eliminar el registro). */
  const clear = React.useCallback(async () => {
    if (!key) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      await offlineDb.drafts.delete(key);
      setMeta(null);
    } catch {
      /* noop */
    }
  }, [key]);

  // Persistir al ocultar la pestaña (móvil: cambio de app / bloqueo de pantalla).
  React.useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
    };
  }, [enabled, flush]);

  // Cargar el meta inicial del borrador guardado.
  React.useEffect(() => {
    let alive = true;
    void load().then((rec) => {
      if (alive && rec) setMeta({ dirty: rec.dirty, updatedAt: rec.updatedAt, error: rec.error });
    });
    return () => {
      alive = false;
    };
  }, [load]);

  return { save, flush, load, markSynced, markError, clear, meta };
}
