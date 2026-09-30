import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rebuild, manifest, verifyManifest } from './rebuild/replay.mjs';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Reconstruction provenance preserves history and covers both observed gaps', () => {
  verifyManifest();
  assert.equal(manifest.migrations[0].sources.filter(s => s.path.includes('/main-migrations/')).length, 13);
  assert.equal(manifest.excluded_historical.length, 4);
  assert.equal(manifest.migrations[0].sources.filter(s => s.mode === 'observed-ddl').length, 2);
  for (const entry of manifest.migrations) {
    const sql = read('../database/rebuild/'+entry.file);
    assert.doesNotMatch(sql, /zfcsuxihpakrsohvcwlr|icqdmzndjmxffnlciijs|test_guard/);
  }
});

test('Empty disposable PostgreSQL replays every business migration and exercises schema/RPC/RLS', async t => {
  const applied = [];
  const db = await rebuild({ onStep: path => applied.push(path) });
  try {
    assert.deepEqual(applied, manifest.migrations.map(m => m.file));
    await t.test('reconstructed catalog, RLS, grants, indexes and RPCs match contract', async () => {
      await db.exec(read('./rebuild/schema-regression.sql'));
    });
    await t.test('baseline refuses existing business data without modifying it', async () => {
      await db.exec("insert into public.dispatch_locations(name,address) values ('preserve','preserve')");
      await assert.rejects(db.exec(read('../database/rebuild/'+manifest.migrations[0].file)), /requires an empty public/);
      await db.exec('rollback');
      assert.equal((await db.query('select count(*)::int as n from public.dispatch_locations')).rows[0].n, 1);
      await db.exec('delete from public.dispatch_locations');
    });
    // Test-only guard/bucket setup, after exact candidate replay and catalog validation.
    // This in-process DB cannot connect to the cloud; no remote/project URL is accepted.
    await db.exec("update storage.buckets set id='factory-photos-test',name='factory-photos-test' where id='factory-photos'");
    await db.exec(read('./cloud/test_project_guard.sql'));
    for (const id of ['T008','T009','T010','T011','T012','T018','T019_legacy_writes','T021','T026','T027','T028','T029','T030','T031']) {
      await t.test(`${id} on freshly reconstructed database`, async () => {
        try { await db.exec(read(`./cloud/${id}.sql`)); }
        catch (error) { await db.exec('rollback'); throw error; }
      });
    }
    await t.test('all synthetic business/account/deletion fixtures removed or rolled back', async () => {
      assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 0);
      const tables = (await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private','auth')")).rows;
      for (const {schemaname,tablename} of tables) {
        const {rows} = await db.query(`select count(*)::int as n from "${schemaname}"."${tablename}"`);
        assert.equal(rows[0].n,0,`${schemaname}.${tablename} contains fixtures`);
      }
    });
  } finally { await db.close(); }
});
