import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageProbe, storageObjectPresent } from './cloud/storage-probe.mjs';

const missing = { status: 400, data: { code: 'NoSuchKey', statusCode: '404', error: 'not_found', message: 'Object not found' } };
test('Storage probe recognizes only precise missing-object responses', () => {
  assert.equal(storageObjectPresent({ status: 200, data: null }), true);
  assert.equal(storageObjectPresent(missing), false);
  assert.equal(storageObjectPresent({ ...missing, status: 404 }), false);
  assert.equal(storageObjectPresent({ status: 400, data: { statusCode: '404', error: 'not_found', message: 'Object not found' } }), false);
  for (const result of [
    { status: 400, data: { message: 'Bad Request' } },
    { status: 404, data: null },
    { status: 404, data: { code: 'NoSuchBucket' } },
    { status: 403, data: { code: 'AccessDenied' } },
    { status: 401, data: { code: 'InvalidJWT' } },
    { status: 500, data: missing.data },
  ]) assert.throws(() => storageObjectPresent(result), /inspection HTTP/);
});

test('Storage cleanup waits for both metadata and bytes to disappear', async () => {
  const responses = [{ status: 200 }, { status: 200 }, missing, { status: 200 }, missing, missing];
  const urls = [], sleeps = [];
  const probe = createStorageProbe(async url => { urls.push(url); return responses.shift(); }, 'test-bucket', {
    delays: [0, 1, 2], sleep: async ms => sleeps.push(ms),
  });
  assert.equal(await probe.waitForAbsent('products/test/image.png', 'test-token'), true);
  assert.deepEqual(sleeps, [1, 2]);
  assert.equal(urls.length, 6);
  assert.equal(new Set(urls).size, 6);
  assert.match(urls[0], /object\/info\/test-bucket\/products\/test\/image.png\?probe=/);
  assert.match(urls[1], /object\/test-bucket\/products\/test\/image.png\?probe=/);
});

test('Storage cleanup fails when bytes persist even if metadata is gone', async () => {
  let calls = 0;
  const probe = createStorageProbe(async url => { calls++; return url.includes('/info/') ? missing : { status: 200 }; }, 'test-bucket', {
    delays: [0, 0, 0],
  });
  await assert.rejects(probe.waitForAbsent('photo', 'test-token'), /still present/);
  assert.equal(calls, 6);
});

test('Storage cleanup does not retry or hide authorization and transport errors', async () => {
  for (const fail of [() => ({ status: 403, data: { code: 'AccessDenied' } }), () => { throw new Error('network failed'); }]) {
    let calls = 0;
    const probe = createStorageProbe(async () => { calls++; return fail(); }, 'test-bucket', { delays: [0, 0] });
    await assert.rejects(probe.waitForAbsent('photo', 'test-token'));
    assert.equal(calls, 1);
  }
});
