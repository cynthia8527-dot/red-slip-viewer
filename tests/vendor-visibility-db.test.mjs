import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rebuild} from './rebuild/replay.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20261103041015_add_vendor_visibility.sql',import.meta.url),'utf8');
test('visibility candidate preserves old UUID relations, prices, snapshots, photos and sites; staff may read hidden history',async()=>{
 const db=await rebuild();
 try{
  await db.exec(`insert into auth.users(id,email) values('40000000-0000-4000-8000-000000000001','admin@example.invalid');
  insert into profiles(user_id,email,role,active) values('40000000-0000-4000-8000-000000000001','admin@example.invalid','admin',true);
  select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',false);
  insert into vendors(id,code,short_name) values('50000000-0000-4000-8000-000000000001','2','Synthetic');
  insert into vendor_sites(vendor_id,site_name) values('50000000-0000-4000-8000-000000000001','Synthetic site');
  insert into products(id,name,reference_photo_path) values('60000000-0000-4000-8000-000000000001','Synthetic part','products/60000000-0000-4000-8000-000000000001/photo.png');
  insert into vendor_prices(vendor_id,vendor_name,product_id,unit_price) values('50000000-0000-4000-8000-000000000001','Synthetic','60000000-0000-4000-8000-000000000001',70);
  insert into shipments(vendor_id,vendor_name,item_name,location,unit_price_snapshot,calculated_amount_snapshot) values('50000000-0000-4000-8000-000000000001','Synthetic','Historical part','蘆洲',70,140);`);
  await db.exec(migration);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select is_hidden from vendors')).rows[0].is_hidden,false);
  await db.exec("update vendors set is_hidden=true,code='200';reset role;update profiles set role='staff' where user_id='40000000-0000-4000-8000-000000000001';set role authenticated");
  const v=(await db.query('select id,code,is_active,is_hidden from vendors')).rows[0];assert.equal(v.id,'50000000-0000-4000-8000-000000000001');assert.equal(v.is_active,true);assert.equal(v.is_hidden,true);assert.equal(v.code,'200');
  assert.equal((await db.query('select unit_price from vendor_prices join vendors on vendors.id=vendor_prices.vendor_id')).rows[0].unit_price,'70.00');
  assert.equal((await db.query('select calculated_amount_snapshot from shipments join vendors on vendors.id=shipments.vendor_id')).rows[0].calculated_amount_snapshot,'140');
  assert.equal((await db.query('select site_name from vendor_sites join vendors on vendors.id=vendor_sites.vendor_id')).rows[0].site_name,'Synthetic site');
  assert.equal((await db.query('select reference_photo_path from products')).rows[0].reference_photo_path,'products/60000000-0000-4000-8000-000000000001/photo.png');
  assert.equal((await db.query('update vendors set is_hidden=false returning id')).rows.length,0,'staff cannot restore');
  await db.exec('reset role');await db.exec("update profiles set role='admin';set role authenticated;update vendors set is_hidden=false");assert.equal((await db.query('select is_hidden from vendors')).rows[0].is_hidden,false);
 }finally{await db.close()}
});
