import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright-core';

// Uses real local Auth/PostgREST/Edge/Storage, with no synthetic API responses.
export async function verifyAcceptanceBrowser({status,session,api,sql,token}){
 const root=resolve(import.meta.dirname,'../..');
 const path=[process.env.TEST_BROWSER_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean).find(existsSync);
 assert.ok(path,'Acceptance browser required');
 const apiUrl=new URL(status.API_URL);
 assert.equal(apiUrl.protocol,'http:');
 assert.ok(['127.0.0.1','localhost'].includes(apiUrl.hostname));
 assert.equal(apiUrl.username+apiUrl.password,'');
 const require=createRequire(import.meta.url);
 const sdk=readFileSync(resolve(require.resolve('@supabase/supabase-js'),'../umd/supabase.js'),'utf8')+'\nexport const createClient=supabase.createClient;';
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/config.local.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('export default '+JSON.stringify({supabaseUrl:status.API_URL,supabaseKey:status.ANON_KEY,storageBucket:'factory-photos-test'}));}
  const file=resolve(root,'.'+pathname);if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':extname(file)==='.html'?'text/html':'text/javascript'});res.end(body);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const vendorId=randomUUID(),name='Synthetic UI '+randomUUID();
 const call=async(p,opts={})=>(await api(p,{token,...opts})).json();
 let browser,productId,shipmentId,groupId;
 try{
  await call('/rest/v1/vendors',{method:'POST',headers:{Prefer:'return=representation'},body:{id:vendorId,short_name:name}});
  browser=await chromium.launch({executablePath:path,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();const errors=[],blocked=[],alerts=[];
  await context.addInitScript(({key,session,origin})=>{if(location.origin===origin)localStorage.setItem(key,JSON.stringify(session));},{origin,key:'sb-'+new URL(status.API_URL).hostname.split('.')[0]+'-auth-token',session});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='esm.sh'&&url.pathname.startsWith('/@supabase/supabase-js'))return route.fulfill({status:200,contentType:'text/javascript',body:sdk});
   if(url.origin===origin)return route.continue();
   if(url.origin===new URL(status.API_URL).origin){
    // The app forbids the production bucket name in test config. Map that test-only
    // alias to this disposable platform's baseline bucket; no remote traffic/policy changes.
    url.pathname=url.pathname.replace('/factory-photos-test/','/factory-photos/');
    return route.continue({url:url.href});
   }
   blocked.push(url.hostname);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{alerts.push(d.message());await d.accept();});
  console.log('UI STEP product creation and photo');
  await page.goto(origin+'/calculator/index.html');await page.locator(`[data-vendor-id="${vendorId}"]`).click();
  await page.locator('#newProduct').click();await page.locator('#pName').fill('Cancelled');await page.locator('#cancelProduct').click();
  assert.equal((await call('/rest/v1/vendor_prices?vendor_id=eq.'+vendorId)).length,0);
  await page.locator('#backVendors').click();await page.locator(`[data-vendor-id="${vendorId}"]`).click();await page.locator('#newProduct').click();
  await page.locator('#pName').fill(name);await page.locator('#pMaterial').fill('SK5');await page.locator('#pProcess').fill('研磨');await page.locator('#npPrice').fill('70');await page.locator('#npDate').fill('2000-01-01');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAL0lEQVR4nO3OIQEAAAgDsCd5/2TUgBiYifll2v0UAQEBAQEBAQEBAQEBAQGB78ABwCWEeSOVA7sAAAAASUVORK5CYII=','base64');
  await page.locator('#pPhoto').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await page.waitForFunction(()=>!document.getElementById('cropState').textContent.includes('正在'));
  await page.locator('#saveProduct').evaluate(b=>{b.click();b.click();});await page.locator('#grid .card').waitFor({timeout:30000});
  const prices=await call('/rest/v1/vendor_prices?vendor_id=eq.'+vendorId);assert.equal(prices.length,1);productId=prices[0].product_id;
  const product=(await call('/rest/v1/products?id=eq.'+productId))[0];assert.ok(product.reference_photo_path);
  await page.locator('#grid .photo img').waitFor();await page.waitForFunction(()=>document.querySelector('#grid .photo img')?.naturalWidth>0);
  console.log('UI STEP future price and history');
  await page.locator('[data-price]').click();await page.locator('#prPrice').fill('120');await page.locator('#prDate').fill('2099-01-01');await page.locator('#savePrice').click();await page.waitForFunction(()=>!document.getElementById('priceDialog').open);
  await page.reload();await page.locator(`[data-vendor-id="${vendorId}"]`).click();
  assert.match(await page.locator('#grid .price').innerText(),/70/);await page.getByRole('button',{name:'詳細',exact:true}).click();assert.equal(await page.locator('.priceHistoryRow').count(),2);assert.match(await page.locator('#dPriceHistory').innerText(),/未生效/);await page.locator('#detailClose').click();
  console.log('UI STEP intake and shipment photo');
  await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill(name);await page.locator('#fProduct').selectOption(productId);await page.locator('#fWeight').fill('3');assert.match(await page.locator('#fPreview').innerText(),/70/);
  await page.locator('#cancel').click();assert.equal((await call('/functions/v1/shipments')).shipments.length,0);await page.locator('#toggleForm').click();await page.locator('#fPhotos').setInputFiles({name:'shipment.png',mimeType:'image/png',buffer:png});
  await page.locator('#addTask').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>document.getElementById('syncText').textContent.includes('貨件與照片已同步'),null,{timeout:30000});
  let shipments=(await call('/functions/v1/shipments')).shipments;assert.equal(shipments.length,1);shipmentId=shipments[0].id;groupId=shipments[0].intake_group_id;assert.equal(shipments[0].product_id,productId);
  await page.locator('#tbody [data-edit]').click();await page.waitForFunction(()=>document.querySelector('#eGallery img')?.naturalWidth>0);await page.locator('#eNote').fill('Cancelled edit');await page.locator('#mCancel').click();assert.equal((await call('/functions/v1/shipments')).shipments[0].note,null);
  console.log('UI STEP processing, shipping and query');
  for(const next of ['處理中','完成待出貨','已出貨']){
   const response=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname==='/functions/v1/shipments');
   const select=await page.locator('#tbody .statusSel').elementHandle();
   await select.selectOption(next);assert.equal((await response).status(),200);
   await page.waitForFunction(el=>!el.isConnected,select);await select.dispose();
   await page.waitForFunction(next=>next==='已出貨'?document.getElementById('cShipped').textContent==='1':document.querySelector('#tbody .statusSel')?.value===next,next);
  }
  shipments=(await call('/functions/v1/shipments')).shipments;assert.equal(Number(shipments[0].unit_price_snapshot),70);assert.equal(Number(shipments[0].calculated_amount_snapshot),210);
  await page.locator('[data-tab="shipped"]').click();await page.locator('#allShipDates').click();await page.locator('#search').fill(name);assert.match(await page.locator('#tbody').innerText(),/210/);
  const month=shipments[0].shipped_at.slice(5,7);await page.locator('#shipYear').selectOption(shipments[0].shipped_at.slice(0,4));await page.locator('#shipMonth').selectOption(month==='01'?'02':'01');assert.match(await page.locator('#tbody').innerText(),/沒有資料/);await page.locator('#shipMonth').selectOption(month);assert.match(await page.locator('#tbody').innerText(),/210/);
  await page.locator('#search').fill('Definitely absent');assert.match(await page.locator('#tbody').innerText(),/沒有資料/);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(alerts,[]);
  await context.close();
  console.log('PASS real browser: product/photo double-click → future price/history → intake/photo double-click → processing → ready → shipped → amount/date/search; cancel/back; no remote requests');
 }finally{
  await browser?.close();await new Promise(r=>server.close(r));
  // The caller destroys this entire disposable platform on any failure; exact cleanup on success.
  if(shipmentId){
   assert.match(shipmentId,/^[0-9a-f-]{36}$/);assert.match(groupId,/^[0-9a-f-]{36}$/);
   await call('/functions/v1/shipments',{method:'PATCH',body:{action:'void',id:shipmentId}});
   await call('/functions/v1/shipments',{method:'DELETE',body:{id:shipmentId}});
   await sql(`delete from private.shipment_deletion_jobs where shipment_id='${shipmentId}'; delete from public.intake_groups where id='${groupId}';`);
  }
  if(productId){
   assert.match(productId,/^[0-9a-f-]{36}$/);
   const product=(await call('/rest/v1/products?id=eq.'+productId))[0];
   if(product?.reference_photo_path)await call('/storage/v1/object/factory-photos',{method:'DELETE',body:{prefixes:[product.reference_photo_path]}});
   await sql(`delete from public.vendor_prices where product_id='${productId}';delete from public.products where id='${productId}';`);
  }
  await sql(`delete from public.vendors where id='${vendorId}';`);
 }
}
