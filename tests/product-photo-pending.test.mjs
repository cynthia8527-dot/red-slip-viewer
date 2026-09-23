import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_PRODUCT_PHOTOS, pendingProductPhotos, rememberProductPhoto,
  forgetProductPhoto, recoverProductPhotos,
} from '../data/product-photo-pending.js';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

const job = { userId: 'admin-a', id: 'product-a', path: 'products/product-a/retry.jpg', previousPath: null };

test('T032 pending photo survives a page reload and is attached once', async () => {
  const saved = storage();
  rememberProductPhoto(saved, job);
  const calls = [];
  const result = await recoverProductPhotos(saved, 'admin-a', async item => {
    calls.push(item);
    return { replayed: true, previous_cleanup_pending: false };
  });
  assert.deepEqual(calls, [job]);
  assert.deepEqual(result, { completed: 1, missing: 0, pending: 0 });
  assert.deepEqual(pendingProductPhotos(saved, 'admin-a'), []);
});

test('T032 uncertain failure remains pending, but confirmed missing object is cleared', async () => {
  const saved = storage();
  rememberProductPhoto(saved, job);
  const first = await recoverProductPhotos(saved, 'admin-a', async () => { throw new Error('network timeout'); });
  assert.equal(first.pending, 1);
  assert.deepEqual(pendingProductPhotos(saved, 'admin-a'), [job]);
  const second = await recoverProductPhotos(saved, 'admin-a', async () => {
    throw Object.assign(new Error('uploaded photo object not found'), { status: 409 });
  });
  assert.equal(second.missing, 1);
  assert.deepEqual(pendingProductPhotos(saved, 'admin-a'), []);
});

test('T032 a different account cannot replay another account’s pending photo', async () => {
  const saved = storage();
  rememberProductPhoto(saved, job);
  let called = false;
  await recoverProductPhotos(saved, 'admin-b', async () => { called = true; });
  assert.equal(called, false);
  assert.deepEqual(pendingProductPhotos(saved, 'admin-a'), [job]);
  forgetProductPhoto(saved, job.path);
  assert.equal(saved.getItem(PENDING_PRODUCT_PHOTOS), null);
});

test('T032 cleanup pending stays queued and storage failure prevents uploading', async () => {
  const saved = storage();
  rememberProductPhoto(saved, job);
  const result = await recoverProductPhotos(saved, 'admin-a', async () => ({ previous_cleanup_pending: true }));
  assert.equal(result.pending, 1);
  assert.deepEqual(pendingProductPhotos(saved, 'admin-a'), [job]);
  const unavailable = { getItem: () => null, setItem: () => { throw new Error('quota exceeded'); } };
  assert.throws(() => rememberProductPhoto(unavailable, job), /quota exceeded/);
});
