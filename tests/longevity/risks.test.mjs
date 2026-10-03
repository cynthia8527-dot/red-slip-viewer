// Strict desired invariants. Failures are findings, NOT expected-failure passes.
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
test('L001 exact monetary snapshot: 0.10 × 3 rounds to whole-unit zero',()=>fixture(async db=>{
  const {send}=platform(db);
  assert.equal((await send('POST',body,uuid(10))).status,201);
  const row=(await db.query('select calculated_amount_snapshot = 0 as exact, calculated_amount_snapshot::text as actual from public.shipments')).rows[0];
  assert.equal(row.exact,true,`stored ${row.actual}, expected whole-unit 0`);
}));
test('L003 Taipei January shipment must appear in January/year filter at midnight',()=>{
  const source=readFileSync(new URL('../../board/index.html',import.meta.url),'utf8');
  const start=source.indexOf('function visible(t){'), end=source.indexOf('function sortTasks(',start);
  assert.ok(start>=0 && end>start);
  const context={view:'shipped',filter:'all',locations:['蘆洲','五股','八里'],$:id=>({value:{shipYear:'2028',shipMonth:'01',search:''}[id]})};
  runInNewContext(source.slice(start,end)+';globalThis.visibleForTest=visible;',context);
  const row={status:'已出貨',voided_at:null,shippedAt:'2027-12-31T16:00:00+00:00',vendor:'Synthetic',item:'Synthetic'};
  assert.equal(new Date(row.shippedAt).toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'}),'2028-01-01');
  assert.equal(context.visibleForTest(row),true,'Taipei Jan 1 shipment excluded by January 2028 filter');
});
