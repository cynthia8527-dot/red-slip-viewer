import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/data.json', import.meta.url)));
const schema = readFileSync(new URL('./fixtures/schema.sql', import.meta.url), 'utf8');
function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  for (const row of fixture.vendors) db.prepare('INSERT INTO vendors VALUES (?, ?)').run(row.id, row.short_name);
  for (const row of fixture.dispatch) db.prepare('INSERT INTO dispatch_locations VALUES (?, ?)').run(row.id, row.name);
  for (const row of fixture.products) db.prepare('INSERT INTO products VALUES (?, ?, ?)').run(row.id, row.name, row.reference_photo_path);
  for (const row of fixture.prices) db.prepare('INSERT INTO vendor_prices VALUES (?, ?, ?, ?, ?, ?)').run(row.id, row.vendor_id, row.product_id, row.unit_price, row.effective_date, row.end_date);
  return db;
}

test('T008 vendor edits cannot alter dispatch locations', () => {
  const db = freshDb();
  try {
    db.prepare('UPDATE vendors SET short_name = ? WHERE id = ?').run('旭呈新名', 'vendor-a');
    assert.equal(db.prepare('SELECT name FROM dispatch_locations WHERE id = ?').get('dispatch-a').name, '旭呈叫車點');
  } finally { db.close(); }
});

test('T009 invalid product/vendor/photo relations are rejected', () => {
  const db = freshDb();
  try {
    assert.throws(() => db.prepare('INSERT INTO vendor_prices VALUES (?, ?, ?, ?, ?, ?)').run('bad', 'missing', 'product-a', 1, '2026-01-01', null), /FOREIGN KEY/);
    assert.throws(() => db.prepare('INSERT INTO shipment_photos VALUES (?, ?, ?)').run('photo-bad', 'missing', 'shipments/missing/sample.svg'), /FOREIGN KEY/);
    db.prepare('INSERT INTO shipments VALUES (?, ?, ?, ?)').run('shipment-1', 'vendor-a', 'product-a', 70);
    assert.throws(() => db.prepare('INSERT INTO shipment_photos VALUES (?, ?, ?)').run('photo-wrong', 'shipment-1', 'shipments/other/sample.svg'), /CHECK/);
    assert.throws(() => db.prepare('INSERT INTO products VALUES (?, ?, ?)').run('product-b', '別的商品', 'products/product-a/sample.svg'), /CHECK/);
    assert.equal(existsSync(new URL('./fixtures/sample.svg', import.meta.url)), true);
  } finally { db.close(); }
});

test('T010 duplicate operation key and same-day price do not create duplicate rows', () => {
  const db = freshDb();
  try {
    db.prepare('INSERT INTO operation_keys VALUES (?, ?)').run('op-1', 'shipment-1');
    assert.throws(() => db.prepare('INSERT INTO operation_keys VALUES (?, ?)').run('op-1', 'shipment-2'), /UNIQUE/);
    assert.throws(() => db.prepare('INSERT INTO vendor_prices VALUES (?, ?, ?, ?, ?, ?)').run('dup', 'vendor-a', 'product-a', 100, '2026-09-11', null), /UNIQUE/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_keys').get().n, 1);
  } finally { db.close(); }
});

test('T011 shipment snapshot remains unchanged after later price update', () => {
  const db = freshDb();
  try {
    db.prepare('INSERT INTO shipments VALUES (?, ?, ?, ?)').run('shipment-1', 'vendor-a', 'product-a', 70);
    db.prepare('UPDATE vendor_prices SET unit_price = 50 WHERE id = ?').run('price-old');
    assert.equal(db.prepare('SELECT unit_price_snapshot FROM shipments WHERE id = ?').get('shipment-1').unit_price_snapshot, 70);
  } finally { db.close(); }
});

test('T012 failed multi-row write rolls back without partial product', () => {
  const db = freshDb();
  try {
    assert.throws(() => {
      db.exec('BEGIN');
      try {
        db.prepare('INSERT INTO products VALUES (?, ?, ?)').run('partial', '不可保留', null);
        db.prepare('INSERT INTO vendor_prices VALUES (?, ?, ?, ?, ?, ?)').run('bad', 'missing', 'partial', 1, '2026-01-01', null);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }, /FOREIGN KEY/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE id = ?').get('partial').n, 0);
  } finally { db.close(); }
});

test('T013 synthetic legacy migration keeps old row readable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('./fixtures/legacy.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('./fixtures/migration.sql', import.meta.url), 'utf8'));
    assert.deepEqual({ ...db.prepare('SELECT id, name, is_active FROM legacy_products').get() }, { id: 'legacy-product', name: '舊商品', is_active: 1 });
  } finally { db.close(); }
});
