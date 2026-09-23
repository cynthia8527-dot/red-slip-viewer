import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryMigrations } from './reference/migration-inventory.mjs';

test('T019 historical migration inventory identifies the two missing definitions and excludes unsafe replay steps', () => {
  const report = inventoryMigrations();
  assert.equal(report.files.length, 17);
  assert.deepEqual(report.missingDefinitions, ['public.dispatch_locations table', 'shipments_voided_by_idx index']);
  assert.equal(report.excludedPresent.length, 4);
  assert.ok(report.excludedPresent.some(name => name.includes('backup_schedule')));
  assert.ok(report.excludedPresent.some(name => name.includes('public_read')));
});

test('T019 inventory recognizes real DDL, ignores comments, and rejects duplicate versions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migration-inventory-'));
  try {
    writeFileSync(join(dir, '20260901000000_baseline.sql'), '-- create table public.dispatch_locations (\ncreate table public.dispatch_locations (id uuid);');
    let report = inventoryMigrations(dir);
    assert.deepEqual(report.missingDefinitions, ['shipments_voided_by_idx index']);
    writeFileSync(join(dir, '20260901000001_index.sql'), 'create index if not exists shipments_voided_by_idx on public.shipments(voided_by);');
    report = inventoryMigrations(dir);
    assert.deepEqual(report.missingDefinitions, []);
    writeFileSync(join(dir, '20260901000001_duplicate.sql'), 'select 1;');
    assert.throws(() => inventoryMigrations(dir), /Duplicate migration version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
