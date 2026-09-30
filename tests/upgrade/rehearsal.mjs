import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyManifest } from '../rebuild/replay.mjs';
const root = new URL('../../', import.meta.url);
export const read = p => readFileSync(new URL(p,root),'utf8');
export const upgrade = JSON.parse(read('database/upgrade/manifest.json'));
export function verifyUpgrade() {
  verifyManifest();
  for (const item of [upgrade.legacy_source, upgrade.candidate, ...upgrade.sources]) assert.equal(createHash('sha256').update(read(item.path)).digest('hex'),item.sha256,item.path);
  const candidate = read(upgrade.candidate.path);
  let offset=0;
  for (const source of upgrade.sources) {
    const content=read(source.path).split('\n').filter(l=>!['begin;','commit;'].includes(l.trim().toLowerCase())).join('\n').trim();
    const at=candidate.indexOf(content,offset);assert.ok(at>=offset,'candidate preserves upgrade source');offset=at+content.length;
  }
}
export async function rehearse(exec, report=()=>{}) {
  verifyUpgrade();
  await exec(read('tests/upgrade/fixtures.sql'));
  await exec(read('tests/upgrade/permissions.sql'));
  report('legacy rows and active/inactive/staff permission boundary loaded');
  const cases=[
    ['duplicate vendor pairs', "insert into public.vendors(code,short_name) values(null,'Synthetic legacy vendor')", "delete from public.vendors where id<>'a1100000-0000-4000-8000-000000000021'", /duplicate vendor pairs/],
    ['duplicate dispatch pairs', "insert into public.dispatch_locations(name,address) values('Synthetic dispatch','Synthetic address')", "delete from public.dispatch_locations where id<>'a1100000-0000-4000-8000-000000000071'", /duplicate dispatch pairs/],
    ['invalid photo path', "insert into public.shipment_photos(id,shipment_id,storage_path) values('a1100000-0000-4000-8000-000000000062','a1100000-0000-4000-8000-000000000051','wrong/path')", "delete from public.shipment_photos where id='a1100000-0000-4000-8000-000000000062'", /photo paths require review/],
    ['late RPC return-type conflict', "create function public.record_shipment_cleanup_result(uuid,text) returns text language sql as $$ select 'conflict'::text $$", 'drop function public.record_shipment_cleanup_result(uuid,text)', /cannot change return type/],
  ];
  for(const [name,setup,cleanup,expected] of cases){
    await exec(setup);
    let failure;
    try {await exec(read(upgrade.candidate.path));} catch(error){failure=error;await exec('rollback');}
    assert.ok(failure,`${name} unexpectedly accepted`);assert.match(failure.message,expected);
    await exec(`do $$ begin
      if exists(select 1 from information_schema.columns where table_schema='public' and column_name in ('create_request_id','quick_create_request_id')) or to_regclass('private.shipment_deletion_jobs') is not null then raise exception 'Rejected upgrade left partial DDL'; end if;
      if exists(select 1 from pg_constraint where conname='vendors_code_short_name_unique') then raise exception 'Rejected upgrade left partial constraint'; end if;
    end $$;`);
    await exec(cleanup);
    await exec("do $$ begin if upgrade_proof.capture() is distinct from (select data from upgrade_proof.before_data) then raise exception 'Rejected upgrade altered legacy data'; end if; end $$;");
    report(`${name}: rejected, no partial schema or legacy data changes`);
  }
  await exec(read(upgrade.candidate.path));
  await exec(read('tests/upgrade/verify.sql'));
  await exec(read('tests/upgrade/permissions.sql'));
  report('upgrade preserves all legacy rows/IDs/relations/timestamps/70-unit-price/864.15-amount/grants/policies; legacy writes still work');
  await exec(read('tests/upgrade/cleanup.sql'));
}
