import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { rebuild } from '../rebuild/replay.mjs';
import { platform,userId } from './local-platform.mjs';
import { uuid } from './scenario.mjs';

const source=readFileSync(new URL('../../supabase/functions/shipments/index.ts',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function decimalParts('),source.indexOf('async function priceSnapshot('));
const context={};
runInNewContext(stripTypeScriptTypes(helpers,{mode:'strip'})+';globalThis.money={decimalParts,roundWholeAmount,shipmentWholeAmount}',context);
const {decimalParts,roundWholeAmount,shipmentWholeAmount}=context.money;
const round=value=>{const d=decimalParts(value);return roundWholeAmount(d.numerator,d.denominator);};
// Synthetic monthly specification only. The app has no monthly billing/adjustment endpoint.
const adjusted=(line,adjustment)=>{const d=decimalParts(adjustment);return roundWholeAmount(BigInt(line)*d.denominator+d.numerator,d.denominator);};
const invoice=(lines,issue=true)=>{const untaxed=lines.reduce((a,b)=>a+BigInt(b),0n);const tax=issue?roundWholeAmount(untaxed*5n,100n):0n;return {untaxed,tax,total:untaxed+tax};};

test('whole-unit money: signed ties, decimal exponents, minimum and unchanged input precision',()=>{
  for(const [p,w,m,expected] of [
    ['0.29',50,null,15],['0.10',3,null,0],[70,12.345,null,864],[15,10.5,null,158],[15,20.5,null,308],
    ['1.005','100',null,101],['-1.005','100',null,-101],['2.5',1,null,3],['-2.5',1,null,-3],
    ['0.01',49,null,0],['0.01',50,null,1],['1e-7','5e6',null,1],
    ['1.23','0.001','25.5',26],['1.23','0.001','25.49',25],
    ['9999999999.99','999999999.999',null,'9999999999980000000'],
  ]) assert.equal(shipmentWholeAmount(p,w,m),expected,`${p} * ${w}, minimum ${m}`);
  for(const [value,expected] of [['0.5',1n],['-0.5',-1n],['-0.49',0n],['-1.5',-2n]])assert.equal(round(value),expected);
});

test('anonymous August rule: round lines before sum; adjustment stays separate; tax follows rounded untaxed',()=>{
  const lines=[shipmentWholeAmount(15,10.5,null),shipmentWholeAmount(15,20.5,null)];
  assert.deepEqual(lines,[158,308]);
  assert.deepEqual(invoice(lines),{untaxed:466n,tax:23n,total:489n});
  assert.deepEqual(invoice(lines,false),{untaxed:466n,tax:0n,total:466n});
  assert.deepEqual(invoice([]),{untaxed:0n,tax:0n,total:0n});
  assert.equal(adjusted(158,'-0.5'),158n);
  assert.equal(adjusted(158,'0.5'),159n);
  assert.equal(adjusted(-158,'-0.5'),-159n);
  assert.deepEqual(invoice([adjusted(lines[0],'-1.5'),adjusted(lines[1],'0.5')]),{untaxed:466n,tax:23n,total:489n});
  assert.deepEqual(invoice([10]),{untaxed:10n,tax:1n,total:11n});
  assert.deepEqual(invoice([-10]),{untaxed:-10n,tax:-1n,total:-11n});
});

test('seed 8527: 1000 decimal products/minimums match independent PostgreSQL numeric ROUND',async()=>{
  const db=await rebuild();
  try {
    let seed=8527;const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    const cases=Array.from({length:1000},(_,i)=>({
      price:((next(200001)-100000)/100).toFixed(2),
      weight:((next(200001)-100000)/1000).toFixed(3),
      minimum:i%3===0?((next(100001)-50000)/100).toFixed(2):null,
    }));
    const rows=(await db.query(`select ord,round(case when value->>'minimum' is null then (value->>'price')::numeric*(value->>'weight')::numeric
      else greatest((value->>'price')::numeric*(value->>'weight')::numeric,(value->>'minimum')::numeric) end,0)::text as expected
      from jsonb_array_elements($1::jsonb) with ordinality as t(value,ord) order by ord`,[JSON.stringify(cases)])).rows;
    for(const [i,c] of cases.entries())assert.equal(String(shipmentWholeAmount(c.price,c.weight,c.minimum)),rows[i].expected,JSON.stringify({seed:8527,index:i,...c}));
  } finally {await db.close();}
});

test('actual Edge/SQL: new snapshots are whole units; retries and legacy frozen values stay unchanged',async()=>{
  const db=await rebuild();
  try {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'money@example.invalid']);
    await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'money@example.invalid']);
    await db.query("insert into public.products(id,name) values ($1,'Synthetic money')",[uuid(1)]);
    await db.query("insert into public.vendor_prices(vendor_name,product_id,unit_price,effective_date) values ('Synthetic',$1,15,'2027-01-01')",[uuid(1)]);
    const {send}=platform(db);
    for(const [i,weight,expected] of [[10,10.5,'158'],[11,20.5,'308']]) {
      const body={vendor_name:'Synthetic',item_name:'Synthetic',product_id:uuid(1),weight_kg:weight,status:'已出貨'};
      const first=await send('POST',body,uuid(i));assert.equal(first.status,201);
      assert.equal(String(first.body.shipment.calculated_amount_snapshot),expected);
      const again=await send('POST',body,uuid(i));assert.equal(again.body.replayed,true);assert.equal(again.body.shipment.id,first.body.shipment.id);
    }
    await db.query("insert into public.shipments(id,vendor_name,item_name,product_id,location,status,is_demo,weight_kg,unit_price_snapshot,unit_snapshot,calculated_amount_snapshot) values ($1,'Synthetic','Legacy',$2,'蘆洲','已出貨',false,12.345,70,'kg',864.15)",[uuid(20),uuid(1)]);
    assert.equal((await send('PATCH',{id:uuid(20),status:'已出貨',note:'preserve old snapshot'})).status,200);
    const old=(await db.query('select calculated_amount_snapshot::text as amount from public.shipments where id=$1',[uuid(20)])).rows[0];
    assert.equal(old.amount,'864.15');
    const totals=(await db.query('select sum(calculated_amount_snapshot)::text as untaxed,round(sum(calculated_amount_snapshot)*0.05,0)::text as tax from public.shipments where create_request_id is not null')).rows[0];
    assert.deepEqual(totals,{untaxed:'466',tax:'23'});
  } finally {await db.close();}
});
