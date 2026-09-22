import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { buildTestShipmentsSource } from './cloud/shipments-test-source.mjs';

test('T025 shipment function test deployment maps only the photo bucket', () => {
  assert.throws(() => buildTestShipmentsSource('icqdmzndjmxffnlciijs'));
  assert.throws(() => buildTestShipmentsSource('another-project'));
  const original = readFileSync(new URL('../supabase/functions/shipments/index.ts', import.meta.url), 'utf8');
  const mapped = buildTestShipmentsSource('zfcsuxihpakrsohvcwlr');
  assert.equal(mapped,
    original.replace("admin.storage.from('factory-photos').remove(paths)",
      "admin.storage.from('factory-photos-test').remove(paths)"));
  assert.doesNotMatch(mapped, /admin\.storage\.from\('factory-photos'\)/);
});

function shipmentHandlerWithFakeDatabase() {
  const source = readFileSync(new URL('../supabase/functions/shipments/index.ts', import.meta.url), 'utf8')
    .replace(/^import[^\n]+\n/gm, '');
  const calls = { intakeGroups: 0, atomicCreates: [], atomicUpdates: [] };
  const createdByRequest = new Map();
  const userId = '00000000-0000-4000-8000-000000000001';
  const admin = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from(table) {
      if (table === 'profiles') return {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: { user_id: userId, role: 'admin', active: true } }; },
      };
      if (table === 'intake_groups') {
        calls.intakeGroups++;
        throw new Error('An invalid shipment must not touch intake groups');
      }
      if (table === 'shipments') return {
        select() { return this; }, eq() { return this; },
        async single() { return { data: { id: 'temporary-shipment', vendor_name: 'Test vendor', item_name: 'Test item', location: '蘆洲', status: '未開始', voided_at: null }, error: null }; },
      };
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, args) {
      if (name === 'create_shipment_idempotent') {
        calls.atomicCreates.push(args);
        const previous = createdByRequest.get(args.p_request_id);
        if (previous) {
          if (previous.fingerprint !== args.p_request_fingerprint) {
            return { data: null, error: { code: '22023', message: 'Idempotency-Key was already used for different shipment data' } };
          }
          return { data: { shipment: previous.shipment, replayed: true }, error: null };
        }
        const shipment = { id: `temporary-shipment-${createdByRequest.size + 1}`, ...args.p_shipment, intake_groups: null };
        createdByRequest.set(args.p_request_id, { fingerprint: args.p_request_fingerprint, shipment });
        return { data: { shipment, replayed: false }, error: null };
      }
      assert.equal(name, 'update_shipment_with_group');
      calls.atomicUpdates.push(args);
      return { data: { id: args.p_id, ...args.p_patch, intake_groups: { label: args.p_group_label } }, error: null };
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
    createClient: () => admin, corsHeaders: {}, Deno, Request, Response, crypto, TextEncoder,
    console: { error() {} },
  });
  return { handler, calls };
}

test('T012 invalid shipment is rejected before creating an intake group', async () => {
  const { handler, calls } = shipmentHandlerWithFakeDatabase();
  const response = await handler(new Request('https://offline.invalid/shipments', {
    method: 'POST',
    headers: { Authorization: 'Bearer offline-test' },
    body: JSON.stringify({ vendor_name: 'Test vendor', item_name: '', intake_group_label: 'orphan' }),
  }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'vendor_name and item_name are required' });
  assert.equal(calls.intakeGroups, 0, 'invalid POST must not create an orphan group');
  assert.equal(calls.atomicCreates.length, 0, 'invalid POST must not start a database write');
});

test('T012 valid shipment creation still keeps trimmed vendor and item names', async () => {
  const { handler, calls } = shipmentHandlerWithFakeDatabase();
  const response = await handler(new Request('https://offline.invalid/shipments', {
    method: 'POST',
    headers: { Authorization: 'Bearer offline-test' },
    body: JSON.stringify({ vendor_name: ' Test vendor ', item_name: ' Test item ', intake_group_label: ' New group ', location: '蘆洲' }),
  }));
  assert.equal(response.status, 201);
  assert.equal(calls.atomicCreates.length, 1);
  assert.equal(calls.atomicCreates[0].p_shipment.vendor_name, 'Test vendor');
  assert.equal(calls.atomicCreates[0].p_shipment.item_name, 'Test item');
  assert.equal(calls.atomicCreates[0].p_group_label, 'New group');
  assert.match(calls.atomicCreates[0].p_request_id, /^[0-9a-f-]{36}$/);
  assert.match(calls.atomicCreates[0].p_request_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(calls.intakeGroups, 0);
});

test('T017 a timed-out shipment retry returns the first shipment without creating another', async () => {
  const { handler, calls } = shipmentHandlerWithFakeDatabase();
  const key = 'c0d00000-0000-4000-8000-000000000017';
  const body = JSON.stringify({ vendor_name: 'Retry vendor', item_name: 'Retry item', location: '蘆洲' });
  const send = () => handler(new Request('https://offline.invalid/shipments', {
    method: 'POST',
    headers: { Authorization: 'Bearer offline-test', 'Idempotency-Key': key },
    body,
  }));
  const first = await send();
  const firstData = await first.json();
  const retry = await send();
  const retryData = await retry.json();
  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.equal(firstData.replayed, false);
  assert.equal(retryData.replayed, true);
  assert.equal(retryData.shipment.id, firstData.shipment.id);
  assert.equal(calls.atomicCreates.length, 2, 'both HTTP attempts reach the idempotent database boundary');
  assert.equal(calls.atomicCreates[0].p_request_id, key);
  assert.equal(calls.atomicCreates[1].p_request_id, key);
  assert.equal(calls.atomicCreates[0].p_request_fingerprint, calls.atomicCreates[1].p_request_fingerprint);
});

test('T017 reusing an Idempotency-Key for changed shipment data is rejected', async () => {
  const { handler } = shipmentHandlerWithFakeDatabase();
  const key = 'c0d00000-0000-4000-8000-000000000018';
  const send = (item_name) => handler(new Request('https://offline.invalid/shipments', {
    method: 'POST',
    headers: { Authorization: 'Bearer offline-test', 'Idempotency-Key': key },
    body: JSON.stringify({ vendor_name: 'Retry vendor', item_name, location: '蘆洲' }),
  }));
  assert.equal((await send('First item')).status, 201);
  const changed = await send('Changed item');
  assert.equal(changed.status, 409);
  assert.match((await changed.json()).error, /different shipment data/);
});

test('T012 grouped PATCH delegates group creation and update to one database call', async () => {
  const { handler, calls } = shipmentHandlerWithFakeDatabase();
  const response = await handler(new Request('https://offline.invalid/shipments', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer offline-test' },
    body: JSON.stringify({ id: 'temporary-shipment', intake_group_label: ' New group ', location: '蘆洲' }),
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.atomicUpdates.length, 1);
  assert.equal(calls.atomicUpdates[0].p_group_label, 'New group');
  assert.equal(calls.atomicUpdates[0].p_patch.location, '蘆洲');
  assert.equal(calls.intakeGroups, 0);
});
