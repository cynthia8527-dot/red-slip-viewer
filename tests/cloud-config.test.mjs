import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cloudCases = ['T008', 'T009', 'T010', 'T011', 'T012', 'T018', 'T021', 'T026', 'T027', 'T028'];
const testProject = 'zfcsuxihpakrsohvcwlr';
const mainProject = 'icqdmzndjmxffnlciijs';

test('T024 every cloud SQL case checks the dedicated test-project marker', () => {
  const marker = readFileSync(new URL('./cloud/test_project_guard.sql', import.meta.url), 'utf8');
  assert.match(marker, /create schema test_guard/i);
  assert.match(marker, new RegExp(testProject));
  assert.match(marker, /not exists\s*\(select 1 from storage\.buckets where id = 'factory-photos-test'\)/i);
  assert.match(marker, /exists\s*\(select 1 from storage\.buckets where id = 'factory-photos'\)/i);
  assert.doesNotMatch(marker, new RegExp(mainProject));
  const contracts = readFileSync(new URL('./cloud/enforce_confirmed_data_contracts.sql', import.meta.url), 'utf8');
  assert.match(contracts, /test_guard\.project_identity/);
  assert.match(contracts, new RegExp(testProject));
  assert.match(contracts, /factory-photos-test/);
  assert.doesNotMatch(contracts, new RegExp(mainProject));
  const atomic = readFileSync(new URL('./cloud/create_shipment_atomic.sql', import.meta.url), 'utf8');
  assert.match(atomic, /test_guard\.project_identity/);
  assert.match(atomic, new RegExp(testProject));
  assert.doesNotMatch(atomic, new RegExp(mainProject));
  assert.match(atomic, /security invoker/i);
  assert.match(atomic, /revoke all on function public\.create_shipment_atomic\(jsonb, text, date\) from public, anon, authenticated/i);
  assert.match(atomic, /grant execute on function public\.create_shipment_atomic\(jsonb, text, date\) to service_role/i);
  const idempotent = readFileSync(new URL('./cloud/create_shipment_idempotent.sql', import.meta.url), 'utf8');
  assert.match(idempotent, /test_guard\.project_identity/);
  assert.match(idempotent, new RegExp(testProject));
  assert.doesNotMatch(idempotent, new RegExp(mainProject));
  assert.match(idempotent, /security invoker/i);
  assert.match(idempotent, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(idempotent, /create unique index if not exists shipments_create_request_id_uidx/i);
  assert.match(idempotent, /revoke all on function public\.create_shipment_idempotent\(jsonb, text, date, uuid, text\) from public, anon, authenticated/i);
  assert.match(idempotent, /grant execute on function public\.create_shipment_idempotent\(jsonb, text, date, uuid, text\) to service_role/i);
  const atomicUpdate = readFileSync(new URL('./cloud/update_shipment_atomic.sql', import.meta.url), 'utf8');
  assert.match(atomicUpdate, /test_guard\.project_identity/);
  assert.match(atomicUpdate, new RegExp(testProject));
  assert.doesNotMatch(atomicUpdate, new RegExp(mainProject));
  assert.match(atomicUpdate, /security invoker/i);
  assert.match(atomicUpdate, /revoke all on function public\.update_shipment_with_group\(uuid, jsonb, uuid, text, date\) from public, anon, authenticated/i);
  assert.match(atomicUpdate, /grant execute on function public\.update_shipment_with_group\(uuid, jsonb, uuid, text, date\) to service_role/i);
  const quickProduct = readFileSync(new URL('./cloud/create_product_with_initial_price.sql', import.meta.url), 'utf8');
  assert.match(quickProduct, /test_guard\.project_identity/);
  assert.match(quickProduct, new RegExp(testProject));
  assert.doesNotMatch(quickProduct, new RegExp(mainProject));
  assert.match(quickProduct, /security invoker/i);
  assert.match(quickProduct, /if not private\.is_factory_admin\(\)/i);
  assert.match(quickProduct, /revoke all on function public\.create_product_with_initial_price\([^)]+\) from public, anon/i);
  for (const id of cloudCases) {
    const sql = readFileSync(new URL(`./cloud/${id}.sql`, import.meta.url), 'utf8');
    assert.match(sql, /test_guard\.project_identity/, `${id} missing database guard`);
    assert.match(sql, new RegExp(testProject), `${id} missing test project ID`);
    assert.doesNotMatch(sql, new RegExp(mainProject), `${id} references main project`);
    assert.match(sql, new RegExp(`${id} PASS`), `${id} missing explicit pass result`);
  }
});

test('T024 authenticated cloud runner is test-project-only and ignores local credentials', () => {
  const runner = readFileSync(new URL('./cloud/authenticated-smoke.mjs', import.meta.url), 'utf8');
  const ignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.match(runner, new RegExp(`const projectId = '${testProject}'`));
  assert.match(runner, /const baseUrl = `https:\/\/\$\{projectId\}\.supabase\.co`/);
  assert.doesNotMatch(runner, new RegExp(mainProject));
  assert.match(ignore, /^tests\/cloud\/credentials\.local\.json$/m);
});
