import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTestShipmentsSource } from './cloud/shipments-test-source.mjs';

test('T025 shipment function test deployment maps only the photo bucket', () => {
  assert.throws(() => buildTestShipmentsSource('icqdmzndjmxffnlciijs'));
  assert.throws(() => buildTestShipmentsSource('another-project'));
  const original = readFileSync(new URL('./reference/edge-functions/shipments/index.ts', import.meta.url), 'utf8');
  const mapped = buildTestShipmentsSource('zfcsuxihpakrsohvcwlr');
  assert.equal(mapped,
    original.replace("admin.storage.from('factory-photos').remove(paths)",
      "admin.storage.from('factory-photos-test').remove(paths)"));
  assert.doesNotMatch(mapped, /admin\.storage\.from\('factory-photos'\)/);
});
