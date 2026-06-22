'use client';

import * as React from 'react';
import { useAuth } from '@/modules/auth/useAuth';
import { getMirror, pendingItems, pendingCount } from './outbox';
import { onOfflineChange } from './bus';
import type { OutboxItem } from './db';

interface HasId {
  id: string;
}

interface LocalState<T> {
  mirror: T[];
  deletes: Set<string>;
}

/**
 * Lectura offline-aware de una colección: combina los registros del servidor
 * (de `useAppState`) con el espejo local (registros con cambios sin sincronizar)
 * y oculta los que tienen un `delete` pendiente.
 *
 * - El espejo local PREVALECE sobre el servidor para un mismo id (tiene la
 *   edición local más reciente). Al sincronizarse, la entrada del espejo se
 *   borra y el servidor vuelve a mandar.
 * - Permite cold-start sin conexión: aunque la colección del servidor venga
 *   vacía, los registros creados/editados offline siguen visibles.
 */
export function useOfflineCollection<T extends HasId>(table: string, serverRows: T[]): T[] {
  const { getTenantId } = useAuth();
  const tenantId = getTenantId();
  const [local, setLocal] = React.useState<LocalState<T>>({ mirror: [], deletes: new Set() });

  React.useEffect(() => {
    let alive = true;
    const reload = async () => {
      if (!tenantId) {
        if (alive) setLocal({ mirror: [], deletes: new Set() });
        return;
      }
      const mirror = await getMirror<T>(table, tenantId);
      const items = await pendingItems();
      const deletes = new Set(
        items.filter((i) => i.table === table && i.op === 'delete').map((i) => i.recordId),
      );
      if (alive) setLocal({ mirror, deletes });
    };
    void reload();
    const off = onOfflineChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, [table, tenantId]);

  return React.useMemo(() => {
    const byId = new Map<string, T>();
    for (const r of serverRows) byId.set(r.id, r);
    for (const m of local.mirror) byId.set(m.id, m); // local pendiente prevalece
    for (const id of local.deletes) byId.delete(id);
    return Array.from(byId.values());
  }, [serverRows, local]);
}

/** Estado de sincronización pendiente de un registro concreto (reactivo). */
export function usePendingForRecord(
  table: string,
  id: string | undefined,
): { pending: boolean; error: boolean } {
  const [state, setState] = React.useState({ pending: false, error: false });
  React.useEffect(() => {
    if (!id) {
      setState({ pending: false, error: false });
      return;
    }
    let alive = true;
    const reload = async () => {
      const items = await pendingItems();
      const mine = items.filter((i) => i.table === table && i.recordId === id);
      if (alive) {
        setState({ pending: mine.length > 0, error: mine.some((i) => i.status === 'error') });
      }
    };
    void reload();
    const off = onOfflineChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, [table, id]);
  return state;
}

/** Número de operaciones pendientes de sincronizar (reactivo). */
export function usePendingSyncCount(): number {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    const reload = async () => {
      const n = await pendingCount();
      if (alive) setCount(n);
    };
    void reload();
    const off = onOfflineChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return count;
}

/** Todos los items de la cola (pendientes + con error), en orden FIFO (reactivo). */
export function useOutboxItems(): OutboxItem[] {
  const [items, setItems] = React.useState<OutboxItem[]>([]);
  React.useEffect(() => {
    let alive = true;
    const reload = async () => {
      const all = await pendingItems();
      if (alive) setItems(all);
    };
    void reload();
    const off = onOfflineChange(reload);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return items;
}
