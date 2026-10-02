import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rehearse} from '../upgrade/rehearsal.mjs';
import {installBackupFixture,verifyBackupFixture,removeTestSchedules} from './backup-preservation.mjs';
import {prepareRollback} from './rollback.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Observed backup preservation and reconstructed rollback provenance (cron contract double)',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});const work=mkdtempSync(join(tmpdir(),'red-slip-release-'));
 try{
  await db.exec(read('tests/rebuild/platform-contract.sql'));const m=JSON.parse(read('database/rebuild/manifest.json'));await db.exec(read('database/rebuild/'+m.migrations[0].file));
  await db.exec(`create schema cron;create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,active boolean default true,database text default 'postgres',username text default 'postgres');create table cron.job_run_details(end_time timestamptz);create function cron.schedule(text,text,text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid$$;create function cron.unschedule(bigint) returns boolean language sql as $$delete from cron.job where jobid=$1 returning true$$;`);
  const sql=async text=>(await db.exec(text.replace('create extension if not exists pg_cron with schema pg_catalog;',''))).flatMap(x=>x.rows.map(r=>Object.values(r).join('|'))).join('\n');
  const before=await installBackupFixture(sql);await rehearse(sql);await verifyBackupFixture(sql,before);await removeTestSchedules(sql);
  await assert.rejects(db.exec(read('tests/rebuild/schema-regression.sql')),/Unexpected public table count/);
  await db.exec("set test.observed_backup_fixture='on';"+read('tests/rebuild/schema-regression.sql'));
  assert.equal((await db.query('select count(*)::int as n from public.backup_snapshots')).rows[0].n,0);
  prepareRollback(work);
 }finally{await db.close();rmSync(work,{recursive:true,force:true});}
});
