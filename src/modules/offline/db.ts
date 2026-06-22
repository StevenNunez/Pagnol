'use client';

import Dexie, { type Table } from 'dexie';

/**
 * Capa de almacenamiento local (IndexedDB vía Dexie) para el soporte Offline
 * First de Pagnol.
 *
 * Fase 2 — borradores: cada formulario de terreno (p. ej. una OT) persiste su
 * estado completo aquí en cada cambio. Sobrevive a recargas, cierre de la app
 * y reinicios del dispositivo. `dirty=true` significa "hay ediciones locales
 * que aún no se confirmaron contra el servidor".
 *
 * Fase 3 — outbox + espejo de lectura:
 *   - `outbox`: cola FIFO de mutaciones pendientes de enviar al servidor.
 *   - `mirror`: copia local (mapeada a camelCase) de los registros con cambios
 *     locales sin sincronizar, para poder leerlos sin conexión (cold-start).
 *
 * Fase 4 — `blobs`: fotos/firmas/adjuntos capturados sin conexión. El Blob se
 *   guarda local hasta que el outbox lo sube (op `upload_photo`).
 */

export type DraftStatus = 'local' | 'synced' | 'error';

export type OutboxOp = 'insert' | 'update' | 'delete' | 'upload_photo' | 'delete_file';

export interface BlobRecord {
  /** PK = id de la foto (mismo id que en el array `photos` del registro). */
  id: string;
  tenantId: string;
  table: string;
  recordId: string;
  blob: Blob;
  contentType: string;
  ext: string;
  description: string;
  createdAt: number;
}

export interface OutboxItem {
  /** PK autoincremental → preserva el orden FIFO de encolado. */
  seq?: number;
  op: OutboxOp;
  /** Tabla de Supabase (snake_case), p. ej. 'work_orders'. */
  table: string;
  recordId: string;
  /** Fila en snake_case para insert/update (vacío en delete). */
  payload?: Record<string, unknown>;
  tenantId: string;
  userId: string;
  createdAt: number;
  status: 'pending' | 'error';
  retries: number;
  error?: string;
}

export interface MirrorRecord {
  /** PK = `${table}:${id}`. */
  uid: string;
  table: string;
  id: string;
  tenantId: string;
  /** Objeto de dominio en camelCase (lo que consumen las páginas). */
  data: unknown;
  updatedAt: number;
}

export interface DraftRecord {
  /** Clave única: `${entity}:${entityId}` (p. ej. `work_order:uuid`). */
  key: string;
  entity: string;
  entityId: string;
  tenantId: string;
  /** Snapshot completo del formulario en camelCase (lo que consume la página). */
  data: unknown;
  /** Epoch ms de la última edición local. */
  updatedAt: number;
  /** true = ediciones locales sin confirmar en el servidor. */
  dirty: boolean;
  /** Último error de sincronización, si lo hubo. */
  error?: string;
}

class PagnolOfflineDB extends Dexie {
  drafts!: Table<DraftRecord, string>;
  outbox!: Table<OutboxItem, number>;
  mirror!: Table<MirrorRecord, string>;
  blobs!: Table<BlobRecord, string>;

  constructor() {
    super('pagnol-offline');
    this.version(1).stores({
      // PK = key; índices secundarios por entidad y tenant para futuras consultas.
      drafts: 'key, entity, tenantId, dirty, updatedAt',
    });
    this.version(2).stores({
      drafts: 'key, entity, tenantId, dirty, updatedAt',
      outbox: '++seq, status, table, recordId, tenantId, createdAt',
      mirror: 'uid, table, tenantId, id',
    });
    this.version(3).stores({
      drafts: 'key, entity, tenantId, dirty, updatedAt',
      outbox: '++seq, status, table, recordId, tenantId, createdAt',
      mirror: 'uid, table, tenantId, id',
      blobs: 'id, recordId, tenantId, table',
    });
  }
}

// Singleton: una sola conexión por pestaña.
export const offlineDb = new PagnolOfflineDB();

/**
 * Pide almacenamiento persistente para que el navegador no desaloje los datos
 * cuando el dispositivo se queda corto de espacio (clave en móviles de terreno).
 * Idempotente y silenciosa: si el navegador no lo soporta o lo niega, no rompe.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function draftKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}
