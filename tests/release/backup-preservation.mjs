import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
export const captureBackupStructure=async sql=>(await await sql(`select jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('name',proname,'definition',pg_get_functiondef(oid),'owner',proowner::regrole::text,'acl',proacl::text) order by proname) from pg_proc where pronamespace='private'::regnamespace and proname in ('capture_factory_text_backup','compact_factory_text_backups')),
'columns',(select jsonb_agg(to_jsonb(c) order by ordinal_position) from information_schema.columns c where table_schema='public' and table_name='backup_snapshots'),
'indexes',(select jsonb_agg(to_jsonb(i) order by indexname) from pg_indexes i where schemaname='public' and tablename='backup_snapshots'),
'constraints',(select jsonb_agg(pg_get_constraintdef(oid) order by conname) from pg_constraint where conrelid='public.backup_snapshots'::regclass),
'policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='backup_snapshots'),
'security',(select jsonb_build_object('rls',relrowsecurity,'forced',relforcerowsecurity,'owner',relowner::regrole::text,'acl',relacl::text) from pg_class where oid='public.backup_snapshots'::regclass),
'jobs',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'command',command,'active',active,'database',database,'username',username) order by jobname) from cron.job where jobname in ('factory-text-backup-daily','factory-text-backup-monthly-compact')),
'dispatch_trigger',(select pg_get_triggerdef(oid) from pg_trigger where tgname='set_dispatch_locations_updated_at'),
'price_rpc',(select jsonb_build_object('definition',pg_get_functiondef(oid),'acl',proacl::text) from pg_proc where proname='replace_vendor_price'))::text;`)).trim();
export async function installBackupFixture(sql){
 await sql(read('./observed-backup-structure.sql'));
 // Real scheduler definitions, isolated synthetic data only. Never call a remote capture function.
 await sql("insert into public.backup_snapshots(id,kind,period_key,row_counts,payload) values('be000000-0000-4000-8000-000000000001','manual',null,'{}','{\"synthetic_sentinel\":true}');");
 const before=await captureBackupStructure(sql);
 const parsed=JSON.parse(before);assert.equal(parsed.jobs.length,2);assert.ok(parsed.jobs.every(x=>x.active));
 const observedHashes={capture_factory_text_backup:'aab23f45fa6fc3f33891b09d68d3dd14',compact_factory_text_backups:'607ed3c2a7a64a47cbffe2f336d938f5'};
 for(const fn of parsed.functions){assert.equal(createHash('md5').update(fn.definition).digest('hex'),observedHashes[fn.name],'observed function definition drift');assert.equal(fn.owner,'postgres');assert.equal(fn.acl,'{postgres=X/postgres}');}
 assert.deepEqual(parsed.jobs.map(j=>[j.name,j.schedule,j.command]),[['factory-text-backup-daily','10 19 * * *',"select private.capture_factory_text_backup('daily', null);"],['factory-text-backup-monthly-compact','40 19 1 * *','select private.compact_factory_text_backups();']]);
 return before;
}
export async function verifyBackupFixture(sql,before){
 assert.equal(await captureBackupStructure(sql),before,'backup schema/functions/ACL/RLS/cron or observed trigger changed');
 assert.equal((await sql("select payload->>'synthetic_sentinel' from public.backup_snapshots where id='be000000-0000-4000-8000-000000000001';")).trim(),'true');
 await sql(`insert into public.dispatch_locations(id,name,address) values('be000000-0000-4000-8000-000000000002','Synthetic backup location','Synthetic address');
 select private.capture_factory_text_backup('manual','synthetic-release-check');
 do $$ begin if not exists(select 1 from public.backup_snapshots where period_key='synthetic-release-check' and (payload->>'backup_version')::int=3 and (row_counts->>'dispatch_locations')::int=1 and jsonb_array_length(payload->'dispatch_locations')=1) then raise exception 'v3 backup missing synthetic location';end if;end $$;
 select private.compact_factory_text_backups();
 delete from public.backup_snapshots;
 delete from public.dispatch_locations where id='be000000-0000-4000-8000-000000000002';`);
 assert.equal(await captureBackupStructure(sql),before);
 console.log('PASS observed backup v3: exact structure/functions/ACL/RLS/jobs preserved, sentinel preserved, synthetic capture/compact works');
}
export async function removeTestSchedules(sql){
 await sql("select cron.unschedule(jobid) from cron.job where jobname in ('factory-text-backup-daily','factory-text-backup-monthly-compact');");
}
