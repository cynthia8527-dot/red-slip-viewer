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
  const calls = { intakeGroups: 0, atomicCreates: [] };
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
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, args) {
      assert.equal(name, 'create_shipment_atomic');
      calls.atomicCreates.push(args);
      return { data: { id: 'temporary-shipment', ...args.p_shipment, intake_groups: null }, error: null };
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
    createClient: () => admin, corsHeaders: {}, Deno, Request, Response,
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
  assert.equal(calls.intakeGroups, 0);
});
