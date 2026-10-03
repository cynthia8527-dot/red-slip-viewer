import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyVolumeBrowser } from './browser.mjs';
import { readAllRows } from '../../data/pagination.js';
import { selectCurrentPrices, priceHistory } from '../../data/pricing.js';
export async function runVolume({api,sql,status,token,session}) {
  assert.ok(['127.0.0.1','localhost'].includes(new URL(status.API_URL).hostname));
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const started=performance.now();
  const stages=[{products:100,shipments:100},{products:1200,shipments:1500},{products:3000,shipments:10000}];
  let priorProducts=0,priorShipments=0;
  const makeId=(prefix,n)=>`${prefix}-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const list=async(table)=>{const {data,error}=await readAllRows(()=>client.from(table).select('*'));assert.equal(error,null,`${table} complete read`);return data;};
  await sql(`insert into public.vendors(id,code,short_name) select ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'SYN-'||i,'Synthetic vendor '||i from generate_series(1,100) i;
    insert into public.vendor_sites(id,vendor_id,site_name) select ('b2100000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('b2000000-0000-4000-8000-'||lpad(((i-1)%100+1)::text,12,'0'))::uuid,'Synthetic site '||i from generate_series(1,200) i;`);
  for(const stage of stages){
    const seedStart=performance.now();
    await sql(`insert into public.products(id,name,material,standard_process) select ('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic product '||lpad(i::text,5,'0'),'steel','grind' from generate_series(${priorProducts+1},${stage.products}) i;
    insert into public.vendor_prices(id,vendor_name,vendor_id,product_id,unit_price,minimum_charge,effective_date,end_date)
    select ('b3000000-0000-4000-8000-'||lpad((i*2+v)::text,12,'0'))::uuid,'Synthetic vendor '||((i-1)%100+1),('b2000000-0000-4000-8000-'||lpad(((i-1)%100+1)::text,12,'0'))::uuid,('b1000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,case v when 0 then 70 else 100 end,500,case v when 0 then date '2022-01-01' else date '2026-01-01' end,case v when 0 then date '2025-12-31' else null end from generate_series(${priorProducts+1},${stage.products}) i cross join generate_series(0,1) v;
    insert into public.shipments(id,vendor_name,vendor_id,product_id,item_name,location,status,weight_kg,unit_price_snapshot,unit_snapshot,minimum_charge_snapshot,calculated_amount_snapshot,shipped_at,created_at)
    select ('b4000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'Synthetic vendor '||((i-1)%100+1),('b2000000-0000-4000-8000-'||lpad(((i-1)%100+1)::text,12,'0'))::uuid,('b1000000-0000-4000-8000-'||lpad(((i-1)%${stage.products}+1)::text,12,'0'))::uuid,'Synthetic item '||i,(array['蘆洲','五股','八里'])[(i%3)+1],case when i%5=0 then '處理中' else '已出貨' end,12.345,70,'kg',500,864.15,case when i%5=0 then null else timestamptz '2022-01-01Z'+(i%1460)*interval '1 day' end,timestamptz '2022-01-01Z'+(i%1460)*interval '1 day' from generate_series(${priorShipments+1},${stage.shipments}) i;`);
    const seedMs=performance.now()-seedStart;
    const samples=[];
    for(let pass=0;pass<3;pass++){
      const t=performance.now();
      const [products,prices,vendors,sites,response]=await Promise.all([list('products'),list('vendor_prices'),list('vendors'),list('vendor_sites'),api('/functions/v1/shipments',{token})]);
      const shipments=(await response.json()).shipments;
      assert.equal(products.length,stage.products);assert.equal(prices.length,2*stage.products);assert.equal(vendors.length,100);assert.equal(sites.length,200);assert.equal(shipments.length,stage.shipments);
      for(const [rows,count] of [[products,stage.products],[prices,stage.products*2],[shipments,stage.shipments]])assert.equal(new Set(rows.map(x=>x.id)).size,count);
      const productIds=new Set(products.map(x=>x.id));
      assert.ok(shipments.every(x=>productIds.has(x.product_id)));
      assert.ok(shipments.every(x=>Number(x.unit_price_snapshot)===70&&Number(x.calculated_amount_snapshot)===864.15));
      const current=selectCurrentPrices(prices,'2026-09-30'),historical=selectCurrentPrices(prices,'2024-06-01');
      assert.equal(current.length,stage.products);assert.equal(historical.length,stage.products);
      assert.ok(current.every(x=>Number(x.unit_price)===100));assert.ok(historical.every(x=>Number(x.unit_price)===70));
      assert.equal(priceHistory(prices,current.at(-1)).length,2);
      assert.equal(shipments.filter(x=>x.status==='已出貨').length,stage.shipments-Math.floor(stage.shipments/5));
      assert.equal(shipments.filter(x=>x.status==='處理中').length,Math.floor(stage.shipments/5));
      assert.ok(shipments.some(x=>x.id===makeId('b4000000',stage.shipments)),'last shipment searchable');
      samples.push(Math.round(performance.now()-t));
    }
    // Native control reproduces the original single-request truncation without changing server settings.
    const {data:single,error}=await client.from('shipments').select('id').eq('is_demo',false);
    assert.equal(error,null);assert.equal(single.length,Math.min(stage.shipments,1000));
    console.log('VOLUME '+JSON.stringify({...stage,prices:stage.products*2,vendors:100,sites:200,passes:3,seed_ms:Math.round(seedMs),complete_reads_ms:samples,legacy_single_query_rows:single.length,missing:0,duplicates:0}));
    priorProducts=stage.products;priorShipments=stage.shipments;
  }
  await verifyVolumeBrowser({status,session});
  // 24 requests with bounded concurrency six; six distinct operations repeated four times.
  const requestIds=Array.from({length:6},()=>randomUUID());
  const writesStarted=performance.now();const ids=new Set();let newCount=0,replayed=0;
  const requests=requestIds.flatMap((key,i)=>Array.from({length:4},()=>({key,i})));
  for(let batch=0;batch<requests.length;batch+=6){
    const results=await Promise.all(requests.slice(batch,batch+6).map(async({key,i})=>{
      const r=await api('/functions/v1/shipments',{token,method:'POST',headers:{'Idempotency-Key':key},body:{vendor_name:'Synthetic retry vendor',item_name:'Synthetic retry '+i,location:'蘆洲',status:'未開始'}});return r.json();
    }));
    for(const r of results){assert.match(r.shipment.id,/^[0-9a-f-]{36}$/);ids.add(r.shipment.id);r.replayed?replayed++:newCount++;}
  }
  assert.equal(ids.size,6);assert.equal(newCount,6);assert.equal(replayed,18);
  const listAfter=(await (await api('/functions/v1/shipments',{token})).json()).shipments;
  assert.equal(listAfter.length,10006);assert.equal(new Set(listAfter.map(x=>x.id)).size,10006);
  console.log('VOLUME WRITES '+JSON.stringify({requests:24,concurrency:6,created:6,replayed:18,elapsed_ms:Math.round(performance.now()-writesStarted)}));
  await sql(`delete from public.shipments where id in (${[...ids].map(id=>`'${id}'`).join(',')}); delete from public.shipments where id::text like 'b4000000-%'; delete from public.vendor_prices where id::text like 'b3000000-%'; delete from public.products where id::text like 'b1000000-%'; delete from public.vendor_sites where id::text like 'b2100000-%'; delete from public.vendors where id::text like 'b2000000-%';`);
  console.log('VOLUME PASS '+JSON.stringify({duration_ms:Math.round(performance.now()-started),max_products:3000,max_prices:6000,max_shipments:10006,stages:3,read_passes:9,soak:false}));
}
