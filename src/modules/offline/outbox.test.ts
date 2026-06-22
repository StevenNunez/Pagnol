import { describe, it, expect, beforeEach } from 'vitest';
import { offlineDb } from './db';
import {
  enqueue,
  pendingItems,
  pendingCount,
  removePendingFor,
  putMirror,
  getMirror,
  deleteMirror,
  discardOutboxItem,
  retryItem,
  retryAllErrored,
} from './outbox';

beforeEach(async () => {
  await offlineDb.outbox.clear();
  await offlineDb.mirror.clear();
  await offlineDb.blobs.clear();
});

describe('outbox / cola', () => {
  it('preserva el orden FIFO de encolado', async () => {
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    await enqueue({ op: 'delete', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    const items = await pendingItems();
    expect(items.map((i) => i.op)).toEqual(['insert', 'update', 'delete']);
  });

  it('removePendingFor detecta el insert pendiente y limpia solo ese registro', async () => {
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'b', tenantId: 't', userId: 'u' });
    const { hadInsert } = await removePendingFor('work_orders', 'a');
    expect(hadInsert).toBe(true);
    const items = await pendingItems();
    expect(items.map((i) => i.recordId)).toEqual(['b']);
  });

  it('removePendingFor devuelve hadInsert=false si solo había updates', async () => {
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    const { hadInsert } = await removePendingFor('work_orders', 'a');
    expect(hadInsert).toBe(false);
    expect(await pendingCount()).toBe(0);
  });
});

describe('mirror / espejo de lectura', () => {
  it('put/get/delete', async () => {
    await putMirror('work_orders', 'a', 't', { id: 'a', name: 'x' });
    expect(await getMirror('work_orders', 't')).toHaveLength(1);
    await deleteMirror('work_orders', 'a');
    expect(await getMirror('work_orders', 't')).toHaveLength(0);
  });

  it('getMirror aísla por tenant', async () => {
    await putMirror('work_orders', 'a', 't1', { id: 'a' });
    await putMirror('work_orders', 'b', 't2', { id: 'b' });
    expect(await getMirror('work_orders', 't1')).toHaveLength(1);
    expect(await getMirror('work_orders', 't2')).toHaveLength(1);
  });
});

describe('reintento / descarte', () => {
  it('discardOutboxItem borra el item y su espejo', async () => {
    await putMirror('work_orders', 'a', 't', { id: 'a' });
    await enqueue({ op: 'insert', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    const [item] = await pendingItems();
    await discardOutboxItem(item.seq!);
    expect(await pendingCount()).toBe(0);
    expect(await getMirror('work_orders', 't')).toHaveLength(0);
  });

  it('retryItem y retryAllErrored reabren items con error', async () => {
    await enqueue({ op: 'update', table: 'work_orders', recordId: 'a', tenantId: 't', userId: 'u' });
    const [item] = await pendingItems();
    await offlineDb.outbox.update(item.seq!, { status: 'error', error: 'x' });
    await retryItem(item.seq!);
    expect((await pendingItems())[0].status).toBe('pending');

    await offlineDb.outbox.update(item.seq!, { status: 'error', error: 'x' });
    await retryAllErrored();
    expect((await pendingItems())[0].status).toBe('pending');
  });
});
