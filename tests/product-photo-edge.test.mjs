import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildTestProductPhotosSource } from './cloud/product-photos-test-source.mjs';

test('T032 product photo test deployment maps only the private test bucket', () => {
  assert.throws(() => buildTestProductPhotosSource('icqdmzndjmxffnlciijs'));
  assert.throws(() => buildTestProductPhotosSource('another-project'));
  const mapped = buildTestProductPhotosSource('zfcsuxihpakrsohvcwlr');
  assert.doesNotMatch(mapped, /admin\.storage\.from\('factory-photos'\)/);
  assert.match(mapped, /admin\.storage\.from\('factory-photos-test'\)/);
});

function productPhotoHandler(options = {}) {
  const source = readFileSync(new URL('../supabase/functions/product-photos/index.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]+\n/gm, '');
  const id = '00000000-0000-4000-8000-000000000032';
  let referencePath = options.referencePath ?? null;
  let removeAttempts = 0;
  const calls = { updates: [], exists: [], removals: [] };
  const userId = '00000000-0000-4000-8000-000000000001';
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    storage: { from(bucket) {
      assert.equal(bucket, 'factory-photos');
      return {
        async exists(path) { calls.exists.push(path); return { data: options.objectExists !== false, error: null }; },
        async remove(paths) {
          calls.removals.push([...paths]); removeAttempts++;
          return options.removeError || (options.removeErrorOnce && removeAttempts === 1)
            ? { data: null, error: { message: 'forced cleanup failure' } }
            : { data: paths.map(name => ({ name })), error: null };
        },
      };
    } },
    from(table) {
      if (table === 'profiles') return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { user_id: userId, role: options.role || 'admin', active: true }, error: null }; },
      };
      assert.equal(table, 'products');
      let patch = null;
      const filters = {};
      return {
        select() { return this; }, update(value) { patch = value; return this; },
        eq(field, value) { filters[field] = value; return this; },
        is(field, value) { filters[field] = value; return this; },
        async maybeSingle() {
          if (!patch) return { data: { id, reference_photo_path: referencePath }, error: null };
          calls.updates.push({ patch, filters: { ...filters } });
          if (options.updateError) return { data: null, error: { message: 'forced link failure' } };
          if ((filters.reference_photo_path ?? null) !== (referencePath ?? null)) return { data: null, error: null };
          referencePath = patch.reference_photo_path;
          return { data: { id, reference_photo_path: referencePath }, error: null };
        },
      };
    },
  };
  let handler;
  const Deno = {
    env: { get(name) {
      if (name === 'SUPABASE_URL') return 'https://zfcsuxihpakrsohvcwlr.supabase.co';
      if (name === 'SUPABASE_SECRET_KEYS') return '{}';
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'offline-test-only';
      return undefined;
    } },
    serve(callback) { handler = callback; },
  };
  runInNewContext(stripTypeScriptTypes(source, { mode: 'strip' }), {
    createClient: () => admin, corsHeaders: {}, Deno, Request, Response, console: { error() {} },
  });
  return { handler, calls, id };
}

function send(handler, id, path, previous = null) {
  return handler(new Request('https://offline.invalid/product-photos', {
    method: 'POST', headers: { Authorization: 'Bearer offline-test' },
    body: JSON.stringify({ id, storage_path: path, previous_storage_path: previous }),
  }));
}

test('T032 product photo attach is replay-safe after an uncertain response', async () => {
  const { handler, calls, id } = productPhotoHandler();
  const path = `products/${id}/retry.jpg`;
  const first = await send(handler, id, path);
  const retry = await send(handler, id, path);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).replayed, false);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).replayed, true);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.removals, []);
});

test('T032 failed product link removes only the new uploaded object', async () => {
  const { handler, calls, id } = productPhotoHandler({ updateError: true });
  const path = `products/${id}/failed.jpg`;
  const response = await send(handler, id, path);
  assert.equal(response.status, 500);
  assert.deepEqual(calls.removals, [[path]]);
});

test('T032 replacing a product photo retries cleanup without relinking', async () => {
  const id = '00000000-0000-4000-8000-000000000032';
  const oldPath = `products/${id}/old.jpg`;
  const newPath = `products/${id}/new.jpg`;
  const { handler, calls } = productPhotoHandler({ referencePath: oldPath, removeErrorOnce: true });
  const first = await send(handler, id, newPath, oldPath);
  assert.equal(first.status, 202);
  assert.equal((await first.json()).previous_cleanup_pending, true);
  const retry = await send(handler, id, newPath, oldPath);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).previous_cleanup_pending, false);
  assert.equal(calls.updates.length, 1);
  assert.deepEqual(calls.removals, [[oldPath], [oldPath]]);
});

test('T032 non-admin cannot attach a product photo', async () => {
  const { handler, calls, id } = productPhotoHandler({ role: 'staff' });
  const response = await send(handler, id, `products/${id}/staff.jpg`);
  assert.equal(response.status, 403);
  assert.equal(calls.updates.length, 0);
  assert.deepEqual(calls.removals, []);
});
