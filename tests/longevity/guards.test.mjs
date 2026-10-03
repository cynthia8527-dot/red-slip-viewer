import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuild,manifest } from '../rebuild/replay.mjs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { platform,userId } from './local-platform.mjs';
import { uuid,capture } from './scenario.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
async function fixture(fn) {
  const db=await rebuild();
  try {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'guard@example.invalid']);
    await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'guard@example.invalid']);
    await db.query("insert into public.products(id,name) values ($1,'Synthetic')",[uuid(1)]);
    await fn(db);
  } finally {await db.close();}
}
test('retention guard protects direct deletion, immutable keys, rollback and grouped retries',()=>fixture(async db=>{
  const {send}=platform(db),key=uuid(10),body={vendor_name:'Synthetic',item_name:'Synthetic',intake_group_label:'before',received_date:'2028-01-01'};
  const first=await send('POST',body,key);assert.equal(first.status,201);const id=first.body.shipment.id;
  await assert.rejects(db.query('update public.shipments set create_request_id=$1 where id=$2',[uuid(11),id]),{code:'22023'});
  await db.exec('begin');await db.query('delete from public.shipments where id=$1',[id]);await db.exec('rollback');
  assert.equal((await send('POST',body,key)).body.replayed,true);
  assert.equal((await db.query('select count(*)::int n from private.retired_shipment_requests')).rows[0].n,0);
  await db.query('delete from public.shipments where id=$1',[id]);
  const before=await capture(db);
  // Changed body would create a new group before INSERT; the rejected insert must roll it back.
  const retry=await send('POST',{...body,intake_group_label:'must-not-leak'},key);
  assert.equal(retry.status,409);assert.match(retry.body.error,/permanently deleted/);
  assert.deepEqual(await capture(db),before);
}));
test('cleanup claim is service-only; private retention and trigger entry points are not exposed',()=>fixture(async db=>{
  for(const role of ['anon','authenticated']) {
    assert.equal((await db.query("select has_function_privilege($1,'public.claim_product_photo_cleanup(uuid,text)','EXECUTE') as allowed",[role])).rows[0].allowed,false);
    for(const table of ['retired_shipment_requests','retired_product_photo_paths']) {
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']) assert.equal((await db.query('select has_table_privilege($1,$2,$3) as allowed',[role,`private.${table}`,privilege])).rows[0].allowed,false);
    }
    for(const fn of ['guard_shipment_request_lifecycle','guard_product_photo_path']) assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed',[role,`private.${fn}()`,'EXECUTE'])).rows[0].allowed,false);
  }
  const path=`products/${uuid(1)}/retired.png`;
  await db.exec('set role service_role');
  assert.equal((await db.query('select public.claim_product_photo_cleanup($1,$2) as claimed',[uuid(1),path])).rows[0].claimed,true);
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.claim_product_photo_cleanup($1,$2)',[uuid(1),path]),{code:'42501'});
  await assert.rejects(db.query('update public.products set reference_photo_path=$1 where id=$2',[path,uuid(1)]),{code:'22023'});
  await db.query('update public.products set name=$1 where id=$2',['Still editable',uuid(1)]);
  await db.exec('reset role');
  assert.equal((await db.query('select reference_photo_path from public.products where id=$1',[uuid(1)])).rows[0].reference_photo_path,null);
}));
test('failed Storage cleanup retires path; retry finishes without changing the active reference',()=>fixture(async db=>{
  const {send,state}=platform(db,'product-photos'),id=uuid(1),old=`products/${id}/old.png`,fresh=`products/${id}/fresh.png`;
  state.objects.set(old,Buffer.from('old'));state.objects.set(fresh,Buffer.from('new'));
  await db.query('update public.products set reference_photo_path=$1 where id=$2',[old,id]);state.failRemove=1;
  assert.equal((await send('POST',{id,storage_path:fresh,previous_storage_path:old})).status,202);
  await assert.rejects(db.query('update public.products set reference_photo_path=$1 where id=$2',[old,id]),{code:'22023'});
  const retry=await send('POST',{id,storage_path:fresh,previous_storage_path:old});assert.equal(retry.status,200);
  assert.equal(state.objects.has(old),false);assert.equal(state.objects.has(fresh),true);
}));
test('missing cleanup RPC fails closed and replay recovers; no unclaimed Storage deletion',()=>fixture(async db=>{
  const {send,state,admin}=platform(db,'product-photos'),id=uuid(1),old=`products/${id}/old.png`,fresh=`products/${id}/fresh.png`;
  state.objects.set(old,Buffer.from('old'));state.objects.set(fresh,Buffer.from('new'));
  await db.query('update public.products set reference_photo_path=$1 where id=$2',[old,id]);
  const rpc=admin.rpc;admin.rpc=async()=>({data:null,error:{code:'42883',message:'injected missing RPC'}});
  assert.equal((await send('POST',{id,storage_path:fresh,previous_storage_path:old})).status,500);
  assert.equal(state.objects.has(old),true);assert.equal(state.objects.has(fresh),true);
  admin.rpc=rpc;
  assert.equal((await send('POST',{id,storage_path:fresh,previous_storage_path:old})).status,200);
  assert.equal(state.objects.has(old),false);assert.equal(state.objects.has(fresh),true);
}));
test('guard migration late conflict rolls back all its earlier DDL without rewriting candidate data',async()=>{
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    await db.exec(read('tests/rebuild/platform-contract.sql'));
    for(const entry of manifest.migrations.slice(0,manifest.migrations.findIndex(e=>e.file.includes("guard_retired_requests"))))await db.exec(read('database/rebuild/'+entry.file));
    await db.query("insert into public.products(id,name) values ($1,'Preserve')",[uuid(1)]);
    await db.exec('create table private.retired_product_photo_paths(storage_path text)');
    const before=await capture(db);
    await assert.rejects(db.exec(read('database/rebuild/'+manifest.migrations.find(e=>e.file.includes("guard_retired_requests")).file)),{code:'42P07'});await db.exec('rollback');
    assert.deepEqual(await capture(db),before);
    assert.equal((await db.query("select to_regclass('private.retired_shipment_requests') as found")).rows[0].found,null);
    assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname like 'shipments_request_%'")).rows[0].n,0);
  } finally {await db.close();}
});
