import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { read, upgrade, rehearse, verifyUpgrade } from './upgrade/rehearsal.mjs';
test('Upgrade candidate provenance and one-transaction failure/data preservation',async()=>{
  verifyUpgrade();
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    await db.exec(read('tests/rebuild/platform-contract.sql'));
    await db.exec(read(upgrade.legacy_source.path));
    await rehearse(sql=>db.exec(sql));
    await db.exec(read('tests/rebuild/schema-regression.sql'));
  } finally {await db.close();}
});
