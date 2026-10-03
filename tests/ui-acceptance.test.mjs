import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright-core';

// Real pages, synthetic API responses only. This is not an Auth/DB/Storage integration test.
const root = resolve(import.meta.dirname, '..');
const sdk = `export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:'acceptance-admin'},access_token:'offline-token'}}})},
 from(table){let cursor='';const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,gt:(_k,v)=>{cursor=v;return q},
 then:async done=>done({data:(await(await fetch('http://127.0.0.1:54321/rest/v1/'+table)).json()).filter(r=>r.id>cursor).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,500),error:null}),
 maybeSingle:async()=>({data:{role:'admin',active:true},error:null})};return q},
 async rpc(name,body){try{return {data:await(await fetch('http://127.0.0.1:54321/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json(),error:null}}catch(error){return {data:null,error}}}
}}`;

test('Synthetic browser acceptance: product, future price/history, intake, status, shipment, date search and cancel', {timeout:60000}, async () => {
 const browserPath=[process.env.TEST_BROWSER_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean).find(existsSync);
 assert.ok(browserPath,'Acceptance browser required; no skips');
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/config.local.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}");return;}
  const file=resolve(root,'.'+path);if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.writeHead(200,{'Content-Type':extname(file)==='.js'?'text/javascript':'text/html'});res.end(await readFile(file));}catch{res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;
 try {
  browser=await chromium.launch({executablePath:browserPath,headless:true});
  const context=await browser.newContext();
  const rows={vendors:[{id:'vendor-a',short_name:'Synthetic vendor',is_active:true}],products:[],vendor_prices:[],shipment_photos:[]};
  const shipments=[],writes=[],errors=[],blocked=[];
  let failStatus=true;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname==='esm.sh')return route.fulfill({status:200,contentType:'text/javascript',body:sdk});
   if(url.origin===origin)return route.continue();
   if(url.origin!=='http://127.0.0.1:54321'){blocked.push(url.hostname);return route.abort();}
   const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization,idempotency-key','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
   const reply=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(req.method()==='GET'){
    if(url.pathname==='/functions/v1/shipments')return reply({shipments});
    const table=url.pathname.replace('/rest/v1/','');
    if(Object.hasOwn(rows,table))return reply(rows[table]);
   }
   const body=req.postDataJSON();writes.push({path:url.pathname,method:req.method(),body});
   if(url.pathname.endsWith('/create_product_with_initial_price_idempotent')){
    const product={id:'product-a',name:body.p_name,material:body.p_material,standard_process:body.p_standard_process,is_active:true};
    rows.products.push(product);rows.vendor_prices.push({id:'price-a',product_id:product.id,vendor_id:body.p_vendor_id,vendor_name:body.p_vendor_name,unit_price:body.p_unit_price,unit:body.p_unit,effective_date:body.p_effective_date,process_name:body.p_vendor_process,note:body.p_price_note});
    await new Promise(r=>setTimeout(r,150));return reply({product,replayed:false});
   }
   if(url.pathname.endsWith('/replace_vendor_price')){
    const old=rows.vendor_prices.find(p=>p.id===body.p_current_price_id);old.end_date='2026-10-02';
    rows.vendor_prices.push({...old,id:'price-b',end_date:null,unit_price:body.p_unit_price,effective_date:body.p_effective_date,note:body.p_note});
    return reply({});
   }
   if(url.pathname==='/functions/v1/shipments'&&req.method()==='POST'){
    const shipment={...body,id:'shipment-a',created_at:'2026-10-02T02:00:00Z',updated_at:'2026-10-02T02:00:00Z'};
    shipments.push(shipment);await new Promise(r=>setTimeout(r,150));return reply({shipment,replayed:false});
   }
   if(url.pathname==='/functions/v1/shipments'&&req.method()==='PATCH'){
    if(failStatus){failStatus=false;return reply({error:'Synthetic temporary failure'},503);}
    const shipment=shipments.find(s=>s.id===body.id);Object.assign(shipment,body);
    if(body.status==='已出貨')Object.assign(shipment,{shipped_at:'2026-10-02T03:00:00Z',unit_price_snapshot:70,unit_snapshot:'kg',calculated_amount_snapshot:210});
    return reply({shipment});
   }
   blocked.push(url.pathname);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const alerts=[];page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
  await page.clock.setFixedTime(new Date('2026-10-02T04:00:00Z'));
  await page.goto(origin+'/calculator/index.html');await page.locator('[data-vendor-id="vendor-a"]').click();
  await page.locator('#newProduct').click();await page.locator('#pName').fill('Cancelled product');await page.locator('#cancelProduct').click();
  assert.equal(writes.length,0,'cancel must not write');
  await page.locator('#backVendors').click();await page.locator('[data-vendor-id="vendor-a"]').click();await page.locator('#newProduct').click();
  await page.locator('#pName').fill('Synthetic acceptance product');await page.locator('#pMaterial').fill('SK5');await page.locator('#pProcess').fill('研磨');await page.locator('#npPrice').fill('70');await page.locator('#npDate').fill('2026-10-01');
  await page.locator('#saveProduct').evaluate(b=>{b.click();b.click();});await page.locator('#grid .card').waitFor();
  assert.equal(rows.products.length,1,'double click creates one product');
  await page.locator('[data-price="price-a"]').click();await page.locator('#prPrice').fill('999');await page.locator('#cancelPrice').click();assert.equal(writes.length,1);
  await page.locator('[data-price="price-a"]').click();await page.locator('#prPrice').fill('120');await page.locator('#prDate').fill('2026-10-03');await page.locator('#prNote').fill('Tomorrow price');await page.locator('#savePrice').click();
  await page.waitForFunction(()=>!document.getElementById('priceDialog').open);
  assert.match(await page.locator('#grid .price').innerText(),/70/);
  await page.getByRole('button',{name:'詳細',exact:true}).click();assert.equal(await page.locator('.priceHistoryRow').count(),2);assert.match(await page.locator('#dPriceHistory').innerText(),/未生效/);assert.match(await page.locator('#dPriceHistory').innerText(),/目前使用/);await page.locator('#detailClose').click();
  await page.clock.setFixedTime(new Date('2026-10-03T04:00:00Z'));await page.reload();await page.locator('[data-vendor-id="vendor-a"]').click();assert.match(await page.locator('#grid .price').innerText(),/120/);
  await page.clock.setFixedTime(new Date('2026-10-02T04:00:00Z'));await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill('Synthetic vendor');await page.locator('#fProduct').selectOption('product-a');await page.locator('#fWeight').fill('3');
  assert.match(await page.locator('#fPreview').innerText(),/70/);
  const beforeIntake=writes.length;await page.locator('#cancel').click();assert.equal(writes.length,beforeIntake);await page.locator('#toggleForm').click();
  await page.locator('#addTask').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>document.getElementById('cActive').textContent==='1');assert.equal(shipments.length,1);
  const status=page.locator('#tbody .statusSel');const failedDialog=page.waitForEvent('dialog');await status.selectOption('處理中');await failedDialog;
  await page.waitForFunction(()=>document.getElementById('addTask').disabled===false);
  // Reload the authoritative state, check edit cancellation, then retry through the status control.
  await page.locator('#reload').click();await page.waitForFunction(()=>document.querySelector('#tbody .statusSel').value==='未開始');assert.match(alerts.join(' '),/更新失敗/);
  await page.locator('#tbody [data-edit]').click();await page.locator('#eNote').fill('Cancelled note');const beforeCancel=writes.length;await page.locator('#mCancel').click();assert.equal(writes.length,beforeCancel);assert.equal(shipments[0].note,null);
  for(const next of ['處理中','完成待出貨','已出貨']){const response=page.waitForResponse(r=>r.request().method()==='PATCH');await status.selectOption(next);await response;await page.waitForFunction(next=>next==='已出貨'?document.getElementById('cShipped').textContent==='1':document.querySelector('#tbody .statusSel').value===next&&document.getElementById('syncText').textContent.includes('已同步'),next);}
  await page.locator('[data-tab="shipped"]').click();await page.locator('#search').fill('Synthetic acceptance product');assert.match(await page.locator('#tbody').innerText(),/210/);
  await page.locator('#shipMonth').selectOption('09');assert.match(await page.locator('#tbody').innerText(),/沒有資料/);await page.locator('#shipMonth').selectOption('10');assert.match(await page.locator('#tbody').innerText(),/Synthetic acceptance product/);
  await page.locator('#search').fill('No such item');assert.match(await page.locator('#tbody').innerText(),/沒有資料/);await page.locator('#search').fill('');await page.locator('#allShipDates').click();assert.match(await page.locator('#tbody').innerText(),/210/);
  assert.equal(shipments[0].status,'已出貨');assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.equal(alerts.length,1);
  await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
