// Fixed high-risk regressions; included in the offline release gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rebuild } from '../rebuild/replay.mjs';
import { platform,userId } from './local-platform.mjs';
import { uuid } from './scenario.mjs';
async function fixture(fn) {
  const db=await rebuild();
  try {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'risk@example.invalid']);
    await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'risk@example.invalid']);
    await db.query("insert into public.products(id,name) values ($1,'Synthetic')",[uuid(1)]);
    await db.query("insert into public.vendor_prices(vendor_name,product_id,unit_price,effective_date) values ('Synthetic',$1,0.10,'2027-01-01')",[uuid(1)]);
    await fn(db);
  } finally {await db.close();}
}
const body={vendor_name:'Synthetic',item_name:'Synthetic',product_id:uuid(1),weight_kg:3,status:'已出貨'};
test('L002 delayed create retry after permanent deletion must not resurrect shipment',()=>fixture(async db=>{
  const {send,state}=platform(db);
  const first=await send('POST',body,uuid(10));assert.equal(first.status,201);
  const id=first.body.shipment.id;
  assert.equal((await send('PATCH',{id,action:'void'})).status,200);
  assert.equal((await send('DELETE',{id})).status,200);
  state.now='2028-01-01T04:00:00Z';
  const retry=await send('POST',body,uuid(10));
  assert.equal(retry.status,409);
  assert.match(retry.body.error,/permanently deleted/);
  assert.equal((await db.query('select count(*)::int as n from public.shipments')).rows[0].n,0,
    `delayed retry returned ${retry.status}; replayed=${retry.body.replayed}; newId=${retry.body.shipment?.id!==id}`);
}));
test('L004 known concurrent photo swap: referenced object must survive final-check/delete interleaving',()=>fixture(async db=>{
  const {send,state}=platform(db,'product-photos'), id=uuid(1);
  const old=`products/${id}/old.png`, fresh=`products/${id}/new.png`;
  await db.query('update public.products set reference_photo_path=$1 where id=$2',[old,id]);
  state.objects.set(old,Buffer.from('old'));state.objects.set(fresh,Buffer.from('new'));
  let second;
  state.beforeRemove=async paths=>{
    if(paths.includes(old)) {
      state.beforeRemove=null;
      second=await send('POST',{id,storage_path:old,previous_storage_path:fresh});
      assert.equal(second.status,409);
    }
  };
  const first=await send('POST',{id,storage_path:fresh,previous_storage_path:old});
  assert.equal(first.status,201);assert.ok(second,'interleaving must execute');
  const current=(await db.query('select reference_photo_path from public.products where id=$1',[id])).rows[0].reference_photo_path;
  assert.equal(current,fresh);
  assert.equal(state.objects.has(current),true,'both calls succeeded but DB references deleted Storage object');
}));
