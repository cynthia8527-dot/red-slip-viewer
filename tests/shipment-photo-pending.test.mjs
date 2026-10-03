import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PENDING_SHIPMENT_PHOTOS, SHIPMENT_PHOTO_UPLOAD_GRACE_MS, pendingShipmentPhotos,
  rememberShipmentPhoto, forgetShipmentPhoto, recoverShipmentPhotos } from '../data/shipment-photo-pending.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const job = { userId: 'staff-a', shipmentId: 'shipment-a', path: 'shipments/shipment-a/photo.jpg' };

test('T021 page reload replays the exact shipment photo path once', async () => {
  const saved = storage(); rememberShipmentPhoto(saved, job);
  const [pending] = pendingShipmentPhotos(saved, 'staff-a');
  const calls = [];
  const result = await recoverShipmentPhotos(saved, 'staff-a', async item => { calls.push(item); return { replayed: true }; });
  assert.deepEqual(calls, [pending]);
  assert.deepEqual(result, { completed: 1, missing: 0, pending: 0 });
  assert.equal(saved.getItem(PENDING_SHIPMENT_PHOTOS), null);
});

test('T021 uncertain failure stays queued, including errors with no HTTP response', async () => {
  const saved = storage(); rememberShipmentPhoto(saved, job);
  assert.deepEqual(await recoverShipmentPhotos(saved, 'staff-a', async () => { throw new Error('timeout'); }), { completed: 0, missing: 0, pending: 1 });
  assert.equal(pendingShipmentPhotos(saved, 'staff-a').length, 1);
});

test('T021 early missing object stays queued; confirmed late absence is reported', async () => {
  const saved = storage(); rememberShipmentPhoto(saved, job);
  const created = pendingShipmentPhotos(saved, 'staff-a')[0].createdAt;
  const missing = async () => { throw Object.assign(new Error('uploaded photo object not found'), { status: 409 }); };
  assert.equal((await recoverShipmentPhotos(saved, 'staff-a', missing, created + 1)).pending, 1);
  assert.equal((await recoverShipmentPhotos(saved, 'staff-a', missing, created + SHIPMENT_PHOTO_UPLOAD_GRACE_MS)).missing, 1);
  assert.deepEqual(pendingShipmentPhotos(saved, 'staff-a'), []);
});

test('T021 other account cannot replay a pending photo, and storage failure stops upload', async () => {
  const saved = storage(); rememberShipmentPhoto(saved, job);
  await recoverShipmentPhotos(saved, 'staff-b', async () => assert.fail('wrong account replay'));
  assert.equal(pendingShipmentPhotos(saved, 'staff-a').length, 1);
  forgetShipmentPhoto(saved, job.path);
  assert.equal(saved.getItem(PENDING_SHIPMENT_PHOTOS), null);
  assert.throws(() => rememberShipmentPhoto({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, job), /quota/);
});

test('T021 board saves a photo job before Storage upload and resumes after login', () => {
  const source = readFileSync(new URL('../board/index.html', import.meta.url), 'utf8');
  assert.match(source, /rememberShipmentPhoto\(sessionStorage,[^;]+;\s*const \{error:ue\}=await supabaseClient\.storage/);
  assert.match(source, /await attachShipmentPhoto\(shipmentId,path\);\s*forgetShipmentPhoto\(sessionStorage,path\)/);
  assert.match(source, /await loadAll\(\);await recoverShipmentPhotosOnOpen\(session\)/);
});
