import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock del cliente Supabase: cada operación es un spy reconfigurable por test.
const h = vi.hoisted(() => ({
  upsert: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  update: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  del: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  select: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { photos: [] }, error: null })),
  upload: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
  signedUrl: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { signedUrl: 'https://signed/x.jpg' }, error: null })),
  remove: vi.fn(async (): Promise<{ error: unknown }> => ({ error: null })),
}));

vi.mock('@/modules/core/lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: (...a: unknown[]) => h.upsert(...(a as [])),
      update: () => ({ eq: () => h.update() }),
      delete: () => ({ eq: () => h.del() }),
      select: () => ({ eq: () => ({ single: () => h.select(), maybeSingle: () => h.select() }) }),
    }),
    storage: {
      from: () => ({
        upload: () => h.upload(),
        createSignedUrl: () => h.signedUrl(),
        remove: () => h.remove(),
      }),
    },
  },
}));

import { offlineDb } from './db';
import { enqueue, pendingItems, putMirror, getMirror } from './outbox';
import { syncOutbox } from './sync';

beforeEach(async () => {
  await offlineDb.outbox.clear();
  await offlineDb.mirror.clear();
  await offlineDb.blobs.clear();
  h.upsert.mockReset().mockResolvedValue({ error: null });
  h.update.mockReset().mockResolvedValue({ error: null });
  h.del.mockReset().mockResolvedValue({ error: null });
  h.select.mockReset().mockResolvedValue({ data: { photos: [] }, error: null });
  h.upload.mockReset().mockResolvedValue({ error: null });
  h.signedUrl.mockReset().mockResolvedValue({ data: { signedUrl: 'https://signed/x.jpg' }, error: null });
  h.remove.mockReset().mockResolvedValue({ error: null });
});

describe('syncOutbox / motor de sincronización', () => {
  it('insert exitoso: usa upsert idempotente y limpia cola + espejo', async () => {
    await putMirror('work_orders', 'a', 't', { id: 'a' });
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', payload: { id: 'a' }, tenantId: 't', userId: 'u' });

    const res = await syncOutbox();

    expect(res.synced).toBe(1);
    expect(h.upsert).toHaveBeenCalledWith({ id: 'a' }, { onConflict: 'id' });
    expect(await pendingItems()).toHaveLength(0);
    expect(await getMirror('work_orders', 't')).toHaveLength(0);
  });

  it('error de red: corta la corrida y conserva el item como pendiente (no error)', async () => {
    h.upsert.mockRejectedValue(new TypeError('Failed to fetch'));
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', payload: { id: 'a' }, tenantId: 't', userId: 'u' });

    const res = await syncOutbox();

    expect(res.synced).toBe(0);
    const items = await pendingItems();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('pending');
  });

  it('error de validación: marca el item con error y continúa con los siguientes', async () => {
    h.upsert.mockResolvedValueOnce({ error: { message: 'columna inválida' } });
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', payload: { id: 'a' }, tenantId: 't', userId: 'u' });
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'b', payload: { x: 1 }, tenantId: 't', userId: 'u' });

    const res = await syncOutbox();

    expect(res.failed).toBe(1);
    expect(res.synced).toBe(1);
    const items = await pendingItems();
    expect(items).toHaveLength(1);
    expect(items[0].recordId).toBe('a');
    expect(items[0].status).toBe('error');
    expect(items[0].retries).toBe(1);
  });

  it('upload_photo: sube el Blob, asocia la URL y borra el Blob local', async () => {
    await offlineDb.blobs.put({
      id: 'p1',
      tenantId: 't',
      table: 'work_orders',
      recordId: 'a',
      blob: new Blob(['x']),
      contentType: 'image/jpeg',
      ext: 'jpg',
      description: 'd',
      createdAt: Date.now(),
    });
    await enqueue({
      op: 'upload_photo',
      table: 'work_orders',
      recordId: 'a',
      payload: { bucket: 'b', photoId: 'p1', ext: 'jpg', description: 'd' },
      tenantId: 't',
      userId: 'u',
    });

    const res = await syncOutbox();

    expect(res.synced).toBe(1);
    expect(h.upload).toHaveBeenCalled();
    expect(await offlineDb.blobs.get('p1')).toBeUndefined();
  });

  it('delete_file: elimina el archivo de Storage', async () => {
    await enqueue({
      op: 'delete_file',
      table: 'storage',
      recordId: 'p1',
      payload: { bucket: 'b', path: 't/a/p1.jpg' },
      tenantId: 't',
      userId: 'u',
    });

    const res = await syncOutbox();

    expect(res.synced).toBe(1);
    expect(h.remove).toHaveBeenCalled();
    expect(await pendingItems()).toHaveLength(0);
  });
});
