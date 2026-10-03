import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260930040920_add_idempotency_request_columns.sql');
const trial = () => read('./cloud/create_shipment_idempotent.sql');
const requestId = '00000000-0000-4000-8000-000000000001';
const shipment = { vendor_name: 'Offline vendor', item_name: 'Offline item', is_demo: false };
async function legacyDatabase() {
  const db = new PGlite();
  try { await db.exec(read('./fixtures/postgres-legacy.sql')); return db; }
  catch (error) { await db.close(); throw error; }
}

test('T028 PostgreSQL RPC rejects NULL and malformed fingerprints before either write', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(trial());
    for (const fingerprint of [null, '', 'a'.repeat(63), 'G'.repeat(64)]) {
      await assert.rejects(db.query('select public.create_shipment_idempotent($1::jsonb,$2,current_date,$3::uuid,$4)',
        [JSON.stringify(shipment), 'Offline group', requestId, fingerprint]), { code: '22023' });
    }
    const { rows } = await db.query('select (select count(*) from public.shipments)::int as shipments, (select count(*) from public.intake_groups)::int as groups');
    assert.deepEqual(rows, [{ shipments: 0, groups: 0 }]);
  } finally { await db.close(); }
});

test('T019 versioned request-column migration preserves legacy rows and rejects incomplete pairs', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`insert into public.products(id,name) values ('${requestId}','Legacy product');
      insert into public.shipments(id,vendor_name,item_name,unit_price_snapshot) values ('${requestId}','Legacy vendor','Legacy item',70);`);
    await db.exec(migration);
    const oldProduct = (await db.query('select * from public.products')).rows[0];
    assert.deepEqual(oldProduct, { id: requestId, name: 'Legacy product', quick_create_request_id: null, quick_create_request_fingerprint: null });
    const oldShipment = (await db.query('select * from public.shipments')).rows[0];
    assert.equal(oldShipment.id, requestId);
    assert.equal(oldShipment.unit_price_snapshot, '70');
    assert.equal(oldShipment.create_request_id, null);
    assert.equal(oldShipment.create_request_fingerprint, null);
    for (const [table, prefix, nameColumn] of [['products', 'quick_create', 'name'], ['shipments', 'create', 'item_name']]) {
      // Old writes omit both columns and remain valid.
      await db.query(`update public.${table} set ${nameColumn}=$1 where id=$2`, ['Legacy edited', requestId]);
      for (const [id, fingerprint] of [[requestId, null], [null, 'a'.repeat(64)], [requestId, 'invalid']]) {
        await assert.rejects(db.query(`update public.${table} set ${prefix}_request_id=$1, ${prefix}_request_fingerprint=$2 where id=$3`, [id, fingerprint, requestId]), { code: '23514' });
      }
      await db.query(`update public.${table} set ${prefix}_request_id=$1, ${prefix}_request_fingerprint=$2 where id=$1`, [requestId, 'a'.repeat(64)]);
      const insert = table === 'products'
        ? 'insert into public.products(name,quick_create_request_id,quick_create_request_fingerprint) values ($1,$2,$3)'
        : "insert into public.shipments(vendor_name,item_name,create_request_id,create_request_fingerprint) values ('Offline vendor',$1,$2,$3)";
      await assert.rejects(db.query(insert, ['Duplicate', requestId, 'a'.repeat(64)]), { code: '23505' });
      assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 1);
    }
    // A second application must expose drift, not silently ignore existing objects.
    await assert.rejects(db.exec(migration), { code: '42701' });
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('T028 expanded SQL scenario passes on the exact trial RPC in isolated PostgreSQL', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(trial());
    await db.exec(read('./cloud/T028.sql'));
    assert.equal((await db.query('select count(*)::int as n from public.shipments')).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.intake_groups')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('T019 a mid-migration schema conflict rolls back earlier shipment changes and preserves old data', async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`insert into public.shipments(id,vendor_name,item_name,unit_price_snapshot)
      values ('${requestId}','Legacy vendor','Legacy item',70);
      alter table public.products add column quick_create_request_id uuid;`);
    await assert.rejects(db.exec(migration), { code: '42701' });
    await db.exec('rollback');
    const { rows } = await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='shipments' and column_name like 'create_request_%'");
    assert.deepEqual(rows, []);
    assert.equal((await db.query("select count(*)::int as n from pg_indexes where schemaname='public' and indexname='shipments_create_request_id_uidx'")).rows[0].n, 0);
    const old = (await db.query('select id,item_name,unit_price_snapshot from public.shipments')).rows[0];
    assert.deepEqual(old, { id: requestId, item_name: 'Legacy item', unit_price_snapshot: '70' });
  } finally { await db.close(); }
});
