import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
const root=resolve(import.meta.dirname,'..');
// Mock only the external SDK/API boundary; run the repository's real page modules.
const sdk=`export function createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-admin'},access_token:'offline'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'/synthetic-photo.svg'}})})},
 from(table){let cursor='',filters=[],body,method='GET',single=false;const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},order:()=>q,limit:()=>q,gt:(_k,v)=>{cursor=v;return q},update:b=>{body=b;method='PATCH';return q},single:()=>{single=true;return q},maybeSingle:async()=>({data:{role:'admin',active:true},error:null}),
 then:async done=>{const response=await fetch('http://127.0.0.1:54321/rest/v1/'+table,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify({body,filters}):undefined});let data=await response.json();if(!response.ok)return done({data:null,error:data});data=data.filter(r=>r.id>cursor&&filters.every(([k,v])=>r[k]===v)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,500);return done({data:single?data[0]:data,error:null})}};return q}
}}`;
export async function fixture(run){
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path==='/config.local.js'){res.setHeader('Content-Type','text/javascript');return res.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}");}
 const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',['.js','.mjs'].includes(extname(file))?'text/javascript':'text/html');res.end(await readFile(file))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;try{
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});const context=await browser.newContext();
 const rows={vendors:[{id:'vendor-a',code:'2',short_name:'合成甲',is_active:true},{id:'vendor-b',code:'10',short_name:'合成乙',is_active:true},{id:'vendor-c',code:'100',short_name:'合成丙',is_active:true}],vendor_sites:[{id:'site-a',vendor_id:'vendor-a',site_name:'合成分廠'}],products:[{id:'product-a',name:'合成零件',is_active:true}],vendor_prices:[{id:'price-a',vendor_id:'vendor-a',vendor_name:'合成甲',product_id:'product-a',unit:'kg',unit_price:70,effective_date:'2020-01-01',end_date:null}],shipment_photos:[]};const errors=[],blocked=[],writes=[];let failWrite=false,emptyWrite=false,writeGate=null;
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});if(url.origin===origin)return route.continue();
 if(url.origin!=='http://127.0.0.1:54321'){blocked.push(url.href);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,PATCH,OPTIONS'};
 const reply=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
 if(req.method()==='OPTIONS')return reply(null,204);
 if(url.pathname==='/functions/v1/shipments')return reply({shipments:[{id:'shipment-a',vendor_id:'vendor-a',vendor_name:'合成甲',item_name:'合成舊帳',status:'已出貨',shipped_at:'2026-11-03T02:00:00Z',unit_price_snapshot:70,calculated_amount_snapshot:140}]});
 const table=url.pathname.replace('/rest/v1/','');if(!Object.hasOwn(rows,table)){blocked.push(url.href);return route.abort()}
 if(req.method()==='PATCH'){writes.push(req.postDataJSON());if(writeGate)await writeGate;if(emptyWrite){emptyWrite=false;return reply([])}if(failWrite){failWrite=false;return reply({message:'synthetic failure'},503)}const {body,filters}=req.postDataJSON();for(const r of rows[table])if(filters.every(([k,v])=>r[k]===v))Object.assign(r,body)}
 return reply(rows[table]);});
 const page=await context.newPage();page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await run({page,origin,rows,writes,failNextWrite:()=>{failWrite=true},emptyNextWrite:()=>{emptyWrite=true},holdWrites:()=>{let release;writeGate=new Promise(r=>{release=()=>{writeGate=null;r()}});return release}});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
}
test('manual hide, hidden search, failed restore and successful restore retain vendor sites', {timeout:30000},()=>fixture(async({page,origin,failNextWrite})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').click();await page.getByRole('button',{name:'隱藏廠商',exact:true}).click();
 await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});
 await page.getByLabel('廠商清單').selectOption('hidden');await page.locator('#search').fill('合成甲');await page.locator('[data-id="vendor-a"]').click();assert.match(await page.locator('#detail').innerText(),/合成分廠/);
 failNextWrite();await page.getByRole('button',{name:'恢復常用',exact:true}).click();await page.getByRole('button',{name:'恢復常用',exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('[data-id="vendor-a"]').count(),1);
 await page.getByRole('button',{name:'恢復常用',exact:true}).click();await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});await page.getByLabel('廠商清單').selectOption('active');await page.locator('[data-id="vendor-a"]').waitFor();
}));
test('natural vendor numbers and code edits preserve UUID, prices and history across pages', {timeout:30000},()=>fixture(async({page,origin,rows})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('#grid .card').first().waitFor();
 assert.deepEqual(await page.locator('#grid .card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),['vendor-a','vendor-b','vendor-c']);
 await page.locator('[data-id="vendor-a"]').click();await page.locator('#editVendor').click();await page.locator('#vCode').fill('200');await page.locator('#saveVendor').click();await page.waitForFunction(()=>!document.getElementById('vendorBack').classList.contains('open'));
 await page.waitForFunction(()=>document.querySelector('#grid .card')?.dataset.id==='vendor-b');assert.deepEqual(await page.locator('#grid .card').evaluateAll(cards=>cards.map(c=>c.dataset.id)),['vendor-b','vendor-c','vendor-a']);
 await page.locator('#toggleHidden').click();await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});
 await page.goto(origin+'/calculator/index.html');await page.locator('[data-vendor-id="vendor-b"]').waitFor();assert.equal(await page.locator('[data-vendor-id="vendor-a"]').count(),0);
 await page.getByLabel('廠商清單').selectOption('hidden');await page.locator('#vendorSearch').fill('200');await page.locator('[data-vendor-id="vendor-a"]').click();assert.match(await page.locator('#grid').innerText(),/70/);await page.getByRole('button',{name:'詳細',exact:true}).click();assert.match(await page.locator('#dPriceHistory').innerText(),/70/);await page.locator('#detailClose').click();
 await page.goto(origin+'/board/index.html');await page.locator('#syncText').filter({hasText:'已同步'}).waitFor();assert.deepEqual(await page.locator('#vendorList option').evaluateAll(options=>options.map(o=>o.value)),['合成乙','合成丙']);await page.locator('[data-tab="shipped"]').click();await page.locator('#allShipDates').click();await page.locator('#search').fill('合成甲');assert.match(await page.locator('#tbody').innerText(),/合成舊帳/);assert.match(await page.locator('#tbody').innerText(),/140/);
 assert.equal(rows.vendor_prices[0].vendor_id,'vendor-a');
}));
test('local workbook preview keeps A–O source fields and resolves code plus name without any writes', {timeout:30000},()=>fixture(async({page,origin,writes})=>{
 const XLSX=await import('xlsx');const header=['公司編碼','公司','業務分類','產品／規格／加工','現行單價','單價單位','每批底價','價格條件與原文','價格狀態','啟用狀態','待確認問題','來源位置','原左欄','原右欄','紀錄ID'];
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,['2','合成甲','合成加工','原文品名',null,'原表未註單位',null,'條件原文','待確認','停用','待確認問題','合成表 A2','原左','原右','synthetic-source-1'],['2','同號不同公司','合成加工','另一產品',50,'桶',300,null,'使用中','使用中',null,'合成表 A3',null,null,'synthetic-source-2']]),'價格清單');
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').waitFor();
 await page.locator('#previewPrices').setInputFiles({name:'synthetic-prices.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await page.locator('#pricePreviewRows tr').first().waitFor();const first=page.locator('#pricePreviewRows tr').nth(0),second=page.locator('#pricePreviewRows tr').nth(1);
 assert.match(await first.innerText(),/vendor-a/);assert.match(await first.innerText(),/原表未註單位/);assert.match(await first.innerText(),/未載（null）/);assert.match(await first.innerText(),/synthetic-source-1/);assert.match(await first.innerText(),/原左/);assert.match(await first.innerText(),/停用/);
 assert.match(await second.innerText(),/需人工核對/);assert.match(await second.innerText(),/桶/);assert.match(await second.innerText(),/300/);assert.match(await second.innerText(),/vendor-a/);assert.match(await page.locator('#pricePreviewState').innerText(),/僅預覽/);assert.equal(writes.length,0);
 if(process.env.VENDOR_SCREENSHOT_DIR)await page.screenshot({path:process.env.VENDOR_SCREENSHOT_DIR+'/price-preview.png',fullPage:true});
}));
test('empty update is unconfirmed; pending hide cannot repeat or switch the current vendor', {timeout:30000},()=>fixture(async({page,origin,writes,emptyNextWrite,holdWrites})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').click();emptyNextWrite();const dialog=page.waitForEvent('dialog');await page.locator('#toggleHidden').click();assert.match((await dialog).message(),/更新失敗/);await page.locator('#toggleHidden:not(:disabled)').waitFor();assert.equal(await page.locator('[data-id="vendor-a"]').count(),1);
 const release=holdWrites();await page.locator('#toggleHidden').click();await page.locator('[data-id="vendor-b"]').click();await page.locator('[data-id="vendor-a"]').click();assert.equal(await page.locator('#toggleHidden').isDisabled(),true);
 await page.locator('[data-id="vendor-b"]').click();release();await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});assert.match(await page.locator('#detail h2').innerText(),/合成乙/);assert.equal(writes.length,2);
 if(process.env.VENDOR_SCREENSHOT_DIR){await page.getByLabel('廠商清單').selectOption('hidden');await page.locator('[data-id="vendor-a"]').click();await page.screenshot({path:process.env.VENDOR_SCREENSHOT_DIR+'/hidden-vendors.png',fullPage:true});}
}));
test('code edit with zero returned rows stays unconfirmed and keeps the edit form for retry', {timeout:30000},()=>fixture(async({page,origin,emptyNextWrite})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').click();await page.locator('#editVendor').click();await page.locator('#vCode').fill('20');emptyNextWrite();const dialog=page.waitForEvent('dialog');await page.locator('#saveVendor').click();assert.match((await dialog).message(),/儲存失敗/);assert.equal(await page.locator('#vendorBack').evaluate(el=>el.classList.contains('open')),true);await page.locator('#saveVendor:not(:disabled)').waitFor();await page.locator('#saveVendor').click();await page.waitForFunction(()=>!document.getElementById('vendorBack').classList.contains('open'));assert.match(await page.locator('[data-id="vendor-a"]').innerText(),/20/);
}));
