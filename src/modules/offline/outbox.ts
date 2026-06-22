'use client';

import { offlineDb, type OutboxItem, type OutboxOp, type MirrorRecord, type BlobRecord } from './db';
import { emitOfflineChange } from './bus';
import { putBlob, deleteBlob } from './blob-store';

// --- Outbox (cola de sincronización) ----------------------------------------

interface EnqueueArgs {
  op: OutboxOp;
  table: string;
  recordId: string;
  payload?: Record<string, unknown>;
  tenantId: string;
  userId: string;
}

/** Encola una mutación pendiente de enviar al servidor. */
export async function enqueue(args: EnqueueArgs): Promise<void> {
  const item: OutboxItem = {
    ...args,
    createdAt: Date.now(),
    status: 'pending',
    retries: 0,
  };
  await offlineDb.outbox.add(item);
  emitOfflineChange();
}

/** Items pendientes (incluye los marcados con error para reintentar), en orden FIFO. */
export async function pendingItems(): Promise<OutboxItem[]> {
  const items = await offlineDb.outbox.toArray();
  return items.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export async function pendingCount(): Promise<number> {
  return offlineDb.outbox.count();
}

export async function erroredCount(): Promise<number> {
  return offlineDb.outbox.where('status').equals('error').count();
}

/** Reabre un item con error para que el próximo ciclo lo reintente. */
export async function retryItem(seq: number): Promise<void> {
  await offlineDb.outbox.update(seq, { status: 'pending', error: undefined });
  emitOfflineChange();
}

/** Reabre todos los items con error. */
export async function retryAllErrored(): Promise<void> {
  const errored = await offlineDb.outbox.where('status').equals('error').toArray();
  await Promise.all(
    errored.map((i) => (i.seq != null ? offlineDb.outbox.update(i.seq, { status: 'pending', error: undefined }) : undefined)),
  );
  emitOfflineChange();
}

/**
 * Descarta un item de la cola (el usuario renuncia a sincronizarlo) y limpia su
 * rastro local: espejo (insert/update) o Blob (upload_photo). Para insert, el
 * registro desaparece localmente porque nunca llegó al servidor.
 */
export async function discardOutboxItem(seq: number): Promise<void> {
  const item = await offlineDb.outbox.get(seq);
  if (!item) return;
  await offlineDb.outbox.delete(seq);
  if (item.op === 'insert' || item.op === 'update') {
    await deleteMirror(item.table, item.recordId);
  } else if (item.op === 'upload_photo') {
    const photoId = (item.payload as { photoId?: string } | undefined)?.photoId;
    if (photoId) await deleteBlob(photoId);
  }
  emitOfflineChange();
}

/**
 * Elimina de la cola las operaciones pendientes de un registro (al eliminarlo).
 * Devuelve si había un `insert` pendiente: en ese caso el registro nunca llegó
 * al servidor, por lo que no hace falta encolar un `delete`.
 */
export async function removePendingFor(
  table: string,
  recordId: string,
): Promise<{ hadInsert: boolean }> {
  const items = await offlineDb.outbox.where('recordId').equals(recordId).toArray();
  const mine = items.filter((i) => i.table === table);
  let hadInsert = false;
  for (const it of mine) {
    if (it.op === 'insert') hadInsert = true;
    if (it.seq != null) await offlineDb.outbox.delete(it.seq);
  }
  if (mine.length) emitOfflineChange();
  return { hadInsert };
}

// --- Fotos/adjuntos offline (op `upload_photo`) ------------------------------

/** Guarda el Blob local y encola su subida + asociación al registro. */
export async function enqueuePhotoUpload(args: {
  photo: BlobRecord;
  bucket: string;
  userId: string;
}): Promise<void> {
  await putBlob(args.photo);
  await enqueue({
    op: 'upload_photo',
    table: args.photo.table,
    recordId: args.photo.recordId,
    payload: {
      bucket: args.bucket,
      photoId: args.photo.id,
      ext: args.photo.ext,
      description: args.photo.description,
    },
    tenantId: args.photo.tenantId,
    userId: args.userId,
  });
}

/** Encola el borrado de un archivo de Storage (limpieza de huérfanos). */
export async function enqueueFileDelete(args: {
  bucket: string;
  path: string;
  recordId: string;
  tenantId: string;
  userId: string;
}): Promise<void> {
  await enqueue({
    op: 'delete_file',
    table: 'storage',
    recordId: args.recordId,
    payload: { bucket: args.bucket, path: args.path },
    tenantId: args.tenantId,
    userId: args.userId,
  });
}

/** Cancela la subida pendiente de una foto y borra su Blob local. */
export async function removePhotoUpload(photoId: string): Promise<void> {
  const items = await offlineDb.outbox.toArray();
  const mine = items.filter(
    (i) => i.op === 'upload_photo' && (i.payload as { photoId?: string } | undefined)?.photoId === photoId,
  );
  for (const it of mine) {
    if (it.seq != null) await offlineDb.outbox.delete(it.seq);
  }
  await deleteBlob(photoId);
  if (mine.length) emitOfflineChange();
}

// --- Mirror (espejo local de lectura) ----------------------------------------

function mirrorUid(table: string, id: string): string {
  return `${table}:${id}`;
}

/** Guarda/actualiza un registro de dominio (camelCase) en el espejo local. */
export async function putMirror(
  table: string,
  id: string,
  tenantId: string,
  data: unknown,
): Promise<void> {
  const record: MirrorRecord = {
    uid: mirrorUid(table, id),
    table,
    id,
    tenantId,
    data,
    updatedAt: Date.now(),
  };
  await offlineDb.mirror.put(record);
  emitOfflineChange();
}

export async function deleteMirror(table: string, id: string): Promise<void> {
  await offlineDb.mirror.delete(mirrorUid(table, id));
  emitOfflineChange();
}

/** Registros del espejo de una tabla para un tenant. */
export async function getMirror<T>(table: string, tenantId: string): Promise<T[]> {
  const rows = await offlineDb.mirror.where('table').equals(table).toArray();
  return rows.filter((r) => r.tenantId === tenantId).map((r) => r.data as T);
}
