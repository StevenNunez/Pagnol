'use client';

import { offlineDb, type BlobRecord } from './db';
import { emitOfflineChange } from './bus';

/** Guarda un Blob (foto/firma/adjunto) capturado sin conexión. */
export async function putBlob(record: BlobRecord): Promise<void> {
  await offlineDb.blobs.put(record);
  emitOfflineChange();
}

export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  return offlineDb.blobs.get(id);
}

export async function deleteBlob(id: string): Promise<void> {
  await offlineDb.blobs.delete(id);
  emitOfflineChange();
}
