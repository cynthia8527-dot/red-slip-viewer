import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
export const manifest = JSON.parse(read('database/rebuild/manifest.json'));
export function verifyManifest() {
  const files = readdirSync(new URL('database/rebuild/supabase/migrations/', root)).filter(f => f.endsWith('.sql')).sort();
  if (JSON.stringify(files) !== JSON.stringify(manifest.migrations.map(m => m.file.split('/').at(-1)))) {
    throw new Error('Rebuild migration list/order differs from manifest');
  }
  for (const entry of manifest.migrations) {
    for (const item of [{ path: 'database/rebuild/'+entry.file, sha256: entry.sha256 }, ...entry.sources]) {
      if (createHash('sha256').update(read(item.path)).digest('hex') !== item.sha256) throw new Error('Rebuild provenance hash mismatch: '+item.path);
    }
    const candidate = read('database/rebuild/'+entry.file);
    let offset = 0;
    for (const source of entry.sources) {
      let text = read(source.path);
      if (source.mode === 'observed-ddl') text = text.slice(text.indexOf('create '));
      else if (source.mode === 'after-test-guard') text = text.split('$guard$;')[1].trim();
      else if (source.mode === 'rpc-only') text = text.slice(text.indexOf('create or replace function')).trim().replace(/commit;$/, '').trimEnd();
      else if (source.mode !== 'verbatim') throw new Error('Unknown provenance transform');
      const found = candidate.indexOf(text, offset);
      if (found < 0) throw new Error('Candidate omits or alters declared source: '+source.path);
      offset = found + text.length;
    }
  }
}
export async function rebuild({ onStep = () => {} } = {}) {
  verifyManifest();
  // No connection string accepted: this database exists only inside this process.
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(read('tests/rebuild/platform-contract.sql'));
    for (const entry of manifest.migrations) {
      try { await db.exec(read('database/rebuild/'+entry.file)); }
      catch (error) { throw new Error(`${entry.file}: SQLSTATE ${error.code}: ${error.message}`, { cause: error }); }
      onStep(entry.file);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  let db;
  try {
    db = await rebuild({ onStep: file => console.log('REPLAY PASS '+file) });
    console.log('REBUILD PASS: all candidate business migrations replayed; platform contract doubles only, not full Supabase');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await db?.close(); }
}
