import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
const root=resolve(import.meta.dirname,'..');
// Mock only the external SDK/API boundary; run the repository's real page modules.
const sdk=`export function createClient(){return {
 async rpc(name,body){const response=await fetch('http://127.0.0.1:54321/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {data:await response.json(),error:null}},
 auth:{getSession:async()=>({data:{session:{user:{id:'synthetic-admin'},access_token:'offline'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
 storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'/synthetic-photo.svg'}})})},
 from(table){let cursor='',filters=[],body,method='GET',single=false;const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},order:()=>q,limit:()=>q,gt:(_k,v)=>{cursor=v;return q},update:b=>{body=b;method='PATCH';return q},single:()=>{single=true;return q},maybeSingle:async()=>({data:{role:'admin',active:true,display_name:'合成測試管理員'},error:null}),
 then:async done=>{const response=await fetch('http://127.0.0.1:54321/rest/v1/'+table,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify({body,filters}):undefined});let data=await response.json();if(!response.ok)return done({data:null,error:data});data=data.filter(r=>r.id>cursor&&filters.every(([k,v])=>r[k]===v)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,500);return done({data:single?data[0]:data,error:null})}};return q}
}}`;
export async function fixture(run,contextOptions={}){
 const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://127.0.0.1').pathname;
 if(path==='/config.local.js'){res.setHeader('Content-Type','text/javascript');return res.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}");}
 const file=resolve(root,'.'+path);if(!file.startsWith(root+sep))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',['.js','.mjs'].includes(extname(file))?'text/javascript':'text/html');res.end(await readFile(file))}catch{res.writeHead(404).end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 let browser;try{
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});const context=await browser.newContext(contextOptions);
 const rows={vendors:[{id:'vendor-a',code:'2',short_name:'合成甲',is_active:true},{id:'vendor-b',code:'10',short_name:'合成乙',is_active:true},{id:'vendor-c',code:'100',short_name:'合成丙',is_active:true}],vendor_sites:[{id:'site-a',vendor_id:'vendor-a',site_name:'合成分廠'}],products:[{id:'product-a',name:'合成零件',is_active:true}],vendor_prices:[{id:'price-a',vendor_id:'vendor-a',vendor_name:'合成甲',product_id:'product-a',unit:'kg',unit_price:70,effective_date:'2020-01-01',end_date:null}],shipment_photos:[]};const shipments=[{id:'shipment-a',vendor_id:'vendor-a',vendor_name:'合成甲',item_name:'合成舊帳',status:'已出貨',shipped_at:'2026-11-03T02:00:00Z',unit_price_snapshot:70,calculated_amount_snapshot:140}];const errors=[],blocked=[],writes=[];let failWrite=false,emptyWrite=false,writeGate=null;
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});if(url.origin===origin)return route.continue();
 if(url.origin!=='http://127.0.0.1:54321'){blocked.push(url.href);return route.abort()}
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'};
 const reply=(data,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
 if(req.method()==='OPTIONS')return reply(null,204);
 if(url.pathname==='/functions/v1/shipments'){
  if(req.method()==='GET')return reply({shipments});
  const body=req.postDataJSON();writes.push({path:url.pathname,method:req.method(),body});
  if(req.method()==='POST'){const shipment={...body,id:'70000000-0000-4000-8000-'+String(shipments.length+1).padStart(12,'0')};shipments.push(shipment);return reply({shipment})}
  if(req.method()==='PATCH'){const shipment=shipments.find(s=>s.id===body.id);Object.assign(shipment,body);return reply({shipment})}
 }
 if(url.pathname.endsWith('/rpc/create_product_with_initial_price_idempotent')){const body=req.postDataJSON();writes.push({path:url.pathname,method:req.method(),body});const product={id:'60000000-0000-4000-8000-000000000009',name:body.p_name,is_active:true};rows.products.push(product);rows.vendor_prices.push({id:'price-new',vendor_id:body.p_vendor_id,vendor_name:body.p_vendor_name,product_id:product.id,unit_price:body.p_unit_price,unit:body.p_unit,effective_date:body.p_effective_date});return reply({product})}
 const table=url.pathname.replace('/rest/v1/','');if(!Object.hasOwn(rows,table)){blocked.push(url.href);return route.abort()}
 if(req.method()==='PATCH'){writes.push(req.postDataJSON());if(writeGate)await writeGate;if(emptyWrite){emptyWrite=false;return reply([])}if(failWrite){failWrite=false;return reply({message:'synthetic failure'},503)}const {body,filters}=req.postDataJSON();for(const r of rows[table])if(filters.every(([k,v])=>r[k]===v))Object.assign(r,body)}
 return reply(rows[table]);});
 const page=await context.newPage();page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await run({page,origin,rows,writes,shipments,failNextWrite:()=>{failWrite=true},emptyNextWrite:()=>{emptyWrite=true},holdWrites:()=>{let release;writeGate=new Promise(r=>{release=()=>{writeGate=null;r()}});return release}});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
}
test('manual hide, hidden search, failed restore and successful restore retain vendor sites', {timeout:30000},()=>fixture(async({page,origin,failNextWrite})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').click();await page.getByRole('button',{name:'隱藏廠商',exact:true}).click();
 await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});
 await page.locator('#closeDetail').click();await page.getByLabel('廠商清單').selectOption('hidden');await page.locator('#search').fill('合成甲');await page.locator('[data-id="vendor-a"]').click();assert.match(await page.locator('#detail').innerText(),/合成分廠/);
 failNextWrite();await page.getByRole('button',{name:'恢復常用',exact:true}).click();await page.getByRole('button',{name:'恢復常用',exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('[data-id="vendor-a"]').count(),1);
 await page.getByRole('button',{name:'恢復常用',exact:true}).click();await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});await page.locator('#closeDetail').click();await page.getByLabel('廠商清單').selectOption('active');await page.locator('[data-id="vendor-a"]').waitFor();
}));
test('natural vendor numbers and code edits preserve UUID, prices and history across pages', {timeout:30000},()=>fixture(async({page,origin,rows})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('#grid [data-id]').first().waitFor();
 assert.deepEqual(await page.locator('#grid [data-id]').evaluateAll(cards=>cards.map(c=>c.dataset.id)),['vendor-a','vendor-b','vendor-c']);
 await page.locator('[data-id="vendor-a"]').click();await page.locator('#editVendor').click();await page.locator('#vCode').fill('200');await page.locator('#saveVendor').click();await page.locator('#vendorBack').waitFor({state:'hidden'});
 await page.waitForFunction(()=>document.querySelector('#grid [data-id]')?.dataset.id==='vendor-b');assert.deepEqual(await page.locator('#grid [data-id]').evaluateAll(cards=>cards.map(c=>c.dataset.id)),['vendor-b','vendor-c','vendor-a']);
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
 const release=holdWrites();await page.locator('#toggleHidden').click();await page.locator('#closeDetail').click();await page.locator('[data-id="vendor-b"]').click();await page.locator('#closeDetail').click();await page.locator('[data-id="vendor-a"]').click();assert.equal(await page.locator('#toggleHidden').isDisabled(),true);
 await page.locator('#closeDetail').click();await page.locator('[data-id="vendor-b"]').click();release();await page.locator('[data-id="vendor-a"]').waitFor({state:'detached'});assert.match(await page.locator('#detailHeading').innerText(),/合成乙/);assert.equal(writes.length,2);
 if(process.env.VENDOR_SCREENSHOT_DIR){await page.locator('#closeDetail').click();await page.getByLabel('廠商清單').selectOption('hidden');await page.locator('[data-id="vendor-a"]').click();await page.screenshot({path:process.env.VENDOR_SCREENSHOT_DIR+'/hidden-vendors.png',fullPage:true});}
}));
test('code edit with zero returned rows stays unconfirmed and keeps the edit form for retry', {timeout:30000},()=>fixture(async({page,origin,emptyNextWrite})=>{
 await page.goto(origin+'/vendors/index.html');await page.locator('[data-id="vendor-a"]').click();await page.locator('#editVendor').click();await page.locator('#vCode').fill('20');emptyNextWrite();const dialog=page.waitForEvent('dialog');await page.locator('#saveVendor').click();assert.match((await dialog).message(),/儲存失敗/);assert.equal(await page.locator('#vendorBack').isVisible(),true);await page.locator('#saveVendor:not(:disabled)').waitFor();await page.locator('#saveVendor').click();await page.locator('#vendorBack').waitFor({state:'hidden'});assert.match(await page.locator('[data-id="vendor-a"]').innerText(),/20/);
}));
const vendorA='50000000-0000-4000-8000-000000000001',vendorB='50000000-0000-4000-8000-000000000002';
const productA='60000000-0000-4000-8000-000000000001',productB='60000000-0000-4000-8000-000000000002';
function sameNameCatalog(rows){
 rows.vendors=[{id:vendorA,code:'001',short_name:'同名測試廠',invoice_title:'合成甲抬頭',is_active:true},{id:vendorB,code:'002',short_name:'同名測試廠',invoice_title:'合成乙抬頭',is_active:true}];
 rows.products=[{id:productA,name:'甲專屬商品',is_active:true},{id:productB,name:'乙專屬商品',is_active:true},{id:'legacy-product',name:'未歸屬舊價格商品',is_active:true}];
 rows.vendor_prices=[{id:'price-a',vendor_id:vendorA,vendor_name:'同名測試廠',product_id:productA,unit:'kg',unit_price:70},{id:'price-b',vendor_id:vendorB,vendor_name:'同名測試廠',product_id:productB,unit:'kg',unit_price:90},{id:'price-legacy',vendor_id:null,vendor_name:'同名測試廠',product_id:'legacy-product',unit:'kg',unit_price:1}];
}
test('same-name intake requires an explicit UUID choice and uses only that vendor products and submitted identity', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 sameNameCatalog(rows);await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill('同名測試廠');await page.locator('#fItem').fill('手動貨品');
 assert.equal(await page.locator('#fProduct').isDisabled(),true,'ambiguous name must not expose a union of products');
 const dialog=page.waitForEvent('dialog');await page.locator('#addTask').click();assert.match((await dialog).message(),/選擇.*廠商/);assert.equal(writes.length,0);
 const choice=page.getByLabel('新增廠商身份');assert.match(await choice.innerText(),/001.*合成甲抬頭/);assert.match(await choice.innerText(),/002.*合成乙抬頭/);await choice.selectOption(vendorB);
 assert.deepEqual(await page.locator('#fProduct option').evaluateAll(options=>options.filter(o=>o.value).map(o=>o.textContent)),['乙專屬商品']);
 await page.locator('#fProduct').selectOption(productB);assert.match(await page.locator('#fPreview').innerText(),/90/);await page.locator('#fWeight').fill('2');const posted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/functions/v1/shipments'));await page.locator('#addTask').click();await posted;
 const saved=writes.find(w=>w.path==='/functions/v1/shipments').body;assert.equal(saved.vendor_id,vendorB);assert.equal(saved.vendor_name,'同名測試廠');assert.equal(saved.product_id,productB);
}));
test('historical edits retain hidden disabled UUID after code or name changes and never borrow another names legacy price', {timeout:30000},()=>fixture(async({page,origin,rows,writes,shipments})=>{
 sameNameCatalog(rows);Object.assign(rows.vendors[1],{code:'200',short_name:'改名測試廠',is_hidden:true,is_active:false});
 shipments.splice(0,shipments.length,{id:'70000000-0000-4000-8000-000000000002',vendor_id:vendorB,vendor_name:'同名測試廠',product_id:productB,item_name:'歷史乙貨件',status:'已出貨',location:'蘆洲',shipped_at:'2026-11-03T02:00:00Z',unit_price_snapshot:90,calculated_amount_snapshot:180});
 await page.goto(origin+'/board/index.html');await page.locator('[data-tab="shipped"]').click();await page.locator('#allShipDates').click();await page.locator('#search').fill('歷史乙');assert.match(await page.locator('#tbody').innerText(),/180/);await page.locator('#tbody [data-edit]').click();
 const choice=page.getByLabel('編輯廠商身份');assert.equal(await choice.inputValue(),vendorB);assert.match(await choice.innerText(),/200.*合成乙抬頭.*已隱藏.*停用/);
 assert.deepEqual(await page.locator('#eProduct option').evaluateAll(options=>options.filter(o=>o.value).map(o=>o.textContent)),['乙專屬商品']);
 await page.locator('#eNote').fill('僅改備註');const saved=page.waitForResponse(r=>r.request().method()==='PATCH');await page.locator('#saveEdit').click();await saved;
 assert.equal(writes[0].body.vendor_id,vendorB);assert.equal(writes[0].body.vendor_name,'同名測試廠');assert.equal(writes[0].body.product_id,productB);assert.equal(shipments[0].calculated_amount_snapshot,180);
}));
test('editing the typed name clears an explicit UUID while unique names, missing codes and same-code companies keep their own identity', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 sameNameCatalog(rows);const vendorC='50000000-0000-4000-8000-000000000003',vendorD='50000000-0000-4000-8000-000000000004';
 rows.vendors.push({id:vendorC,code:'001',short_name:'另一測試廠',invoice_title:'另一合成抬頭',is_active:true},{id:vendorD,code:null,short_name:'無碼測試廠',invoice_title:'無碼合成抬頭',is_active:true});
 await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill('同名測試廠');await page.getByLabel('新增廠商身份').selectOption(vendorB);
 const submit=async(name,id)=>{await page.locator('#fVendor').fill(name);await page.locator('#fItem').fill('合成手動貨品');assert.equal(await page.locator('#fProduct').inputValue(),'');const posted=page.waitForResponse(r=>r.request().method()==='POST');await page.locator('#addTask').click();await posted;await page.locator('#addTask:not(:disabled)').waitFor();assert.equal(writes.at(-1).body.vendor_id,id);assert.equal(writes.at(-1).body.vendor_name,name)};
 await submit('新輸入的手動廠商',null);await submit('另一測試廠',vendorC);await submit('無碼測試廠',vendorD);
 await page.locator('#fVendor').fill('同名測試廠');assert.equal(await page.getByLabel('新增廠商身份').inputValue(),'');assert.equal(await page.locator('#fProduct').isDisabled(),true);const dialog=page.waitForEvent('dialog');await page.locator('#addTask').click();await dialog;assert.equal(writes.length,3);
}));
test('missing-code hidden disabled choices are identifiable and quick-product RPC receives the selected UUID', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 sameNameCatalog(rows);rows.vendors[0].code=null;Object.assign(rows.vendors[1],{code:null,is_hidden:true,is_active:false});
 await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill('同名測試廠');assert.equal(await page.locator('#quickProduct').isDisabled(),true);
 const choice=page.getByLabel('新增廠商身份');assert.match(await choice.innerText(),/無原碼.*合成甲抬頭/);assert.match(await choice.innerText(),/無原碼.*合成乙抬頭.*已隱藏.*停用/);await choice.selectOption(vendorB);
 await page.locator('#quickProduct').click();assert.match(await page.locator('#qVendor').innerText(),/合成乙抬頭/);await page.locator('#qName').fill('乙新商品');await page.locator('#qPrice').fill('88');await page.locator('#qSave').click();await page.waitForFunction(()=>!document.getElementById('quickBack').classList.contains('open'));
 assert.equal(writes.length,1);assert.equal(writes[0].body.p_vendor_id,vendorB);assert.equal(writes[0].body.p_vendor_name,'同名測試廠');await page.waitForFunction(()=>document.querySelector('#fProduct').value==='60000000-0000-4000-8000-000000000009');assert.match(await page.locator('#fPreview').innerText(),/88/);
 if(process.env.VENDOR_IDENTITY_SCREENSHOT_DIR)await page.screenshot({path:process.env.VENDOR_IDENTITY_SCREENSHOT_DIR+'/same-name-choice.png',fullPage:true});
}));
test('legacy same-name shipment edits require a choice and changing edit text clears its UUID and product', {timeout:30000},()=>fixture(async({page,origin,rows,writes,shipments})=>{
 sameNameCatalog(rows);shipments.splice(0,shipments.length,{id:'70000000-0000-4000-8000-000000000002',vendor_id:null,vendor_name:'同名測試廠',product_id:productB,item_name:'待核對歷史貨件',status:'未開始',location:'蘆洲'});
 await page.goto(origin+'/board/index.html');await page.locator('#tbody [data-edit]').click();assert.equal(await page.locator('#eProduct').isDisabled(),true);const dialog=page.waitForEvent('dialog');await page.locator('#saveEdit').click();assert.match((await dialog).message(),/選擇.*廠商/);assert.equal(writes.length,0);
 await page.getByLabel('編輯廠商身份').selectOption(vendorB);await page.locator('#eProduct').selectOption(productB);let saved=page.waitForResponse(r=>r.request().method()==='PATCH');await page.locator('#saveEdit').click();await saved;await page.waitForFunction(()=>!document.getElementById('modalBack').classList.contains('open'));assert.equal(writes[0].body.vendor_id,vendorB);
 await page.locator('#tbody [data-edit]').click();await page.locator('#eVendor').fill('改成手動廠商');assert.equal(await page.locator('#eProduct').inputValue(),'');saved=page.waitForResponse(r=>r.request().method()==='PATCH');await page.locator('#saveEdit').click();await saved;assert.equal(writes[1].body.vendor_id,null);assert.equal(writes[1].body.product_id,null);assert.equal(writes[1].body.vendor_name,'改成手動廠商');
}));
test('catalog refresh after a displayed code change keeps the explicit UUID and its selected product', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 sameNameCatalog(rows);await page.goto(origin+'/board/index.html');await page.locator('#toggleForm').click();await page.locator('#fVendor').fill('同名測試廠');await page.getByLabel('新增廠商身份').selectOption(vendorB);await page.locator('#fProduct').selectOption(productB);
 rows.vendors[1].code='200';await page.locator('#reload').click();await page.waitForFunction(()=>document.getElementById('fVendorChoice').textContent.includes('200'));assert.equal(await page.getByLabel('新增廠商身份').inputValue(),vendorB);assert.equal(await page.locator('#fProduct').inputValue(),productB);
 if(process.env.VENDOR_IDENTITY_SCREENSHOT_DIR)await page.screenshot({path:process.env.VENDOR_IDENTITY_SCREENSHOT_DIR+'/selected-code-refresh.png',fullPage:true});
 const posted=page.waitForResponse(r=>r.request().method()==='POST');await page.locator('#addTask').click();await posted;assert.equal(writes[0].body.vendor_id,vendorB);assert.equal(writes[0].body.product_id,productB);
}));
function longVendorCatalog(rows){
 rows.vendors=Array.from({length:300},(_,i)=>({id:'50000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),code:String(i+1),short_name:i===299?'合成長名稱廠商'+ '超長名稱測試'.repeat(12):'合成廠商 '+String(i+1).padStart(3,'0'),invoice_title:'合成發票抬頭 '+(i+1),is_active:true,note:i===299?'合成長備註，僅供隔離畫面測試。\n'.repeat(120):'合成備註，僅供畫面檢查。',address:'合成地址，不是真實聯絡資料'}));
 rows.vendor_sites=[{id:'80000000-0000-4000-8000-000000000300',vendor_id:rows.vendors[299].id,site_name:'合成分廠據點',address:'合成分廠地址'}];
}
test('desktop 300-vendor compact list opens the bottom company in view and restores scroll and keyboard focus', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 longVendorCatalog(rows);await page.goto(origin+'/vendors/index.html');const list=page.locator('#grid [data-id]');await page.waitForFunction(()=>document.querySelectorAll('#grid [data-id]').length===300);
 const firstRow=await list.first().boundingBox(),secondRow=await list.nth(1).boundingBox();assert.ok(firstRow.height<=64,'one compact row, rather than a large card');assert.equal(secondRow.x,firstRow.x);assert.ok(secondRow.y>=firstRow.y+firstRow.height-1,'one company per line');if(process.env.VENDOR_LIST_SCREENSHOT_DIR)await page.screenshot({path:process.env.VENDOR_LIST_SCREENSHOT_DIR+'/desktop-list.png'});
 const last=list.last();await last.scrollIntoViewIfNeeded();await last.focus();const before=await page.evaluate(()=>scrollY);await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:rows.vendors[299].short_name,exact:true});await dialog.waitFor();const rect=await dialog.boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=902,'details stay within the current viewport');assert.match(await dialog.innerText(),/合成分廠據點/);
 await page.locator('#closeDetail').focus();await page.keyboard.press('Shift+Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true);await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(d=>d.contains(document.activeElement)),true);
 const top=await page.evaluate(()=>scrollY),behind=await list.nth(298).boundingBox();await page.mouse.click(behind.x+8,behind.y+behind.height/2);assert.equal(await dialog.isVisible(),true);assert.equal(await page.evaluate(()=>scrollY),top,'backdrop click cannot change the list');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await last.evaluate(el=>el===document.activeElement),true);assert.equal(await last.getAttribute('aria-current'),'true');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1,'close restores list position');assert.equal(writes.length,0);if(process.env.VENDOR_LIST_SCREENSHOT_DIR){await list.nth(298).click();await page.screenshot({path:process.env.VENDOR_LIST_SCREENSHOT_DIR+'/desktop-details.png'});}
},{viewport:{width:1440,height:900}}));
test('company editing opens above details, traps focus, cancels with Escape and saves to the selected UUID', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 longVendorCatalog(rows);await page.goto(origin+'/vendors/index.html');const last=page.locator('#grid [data-id]').last();await last.scrollIntoViewIfNeeded();await last.click();await page.getByRole('button',{name:'修改廠商',exact:true}).click();
 const edit=page.getByRole('dialog',{name:'修改廠商',exact:true});await edit.waitFor();await page.locator('#vCode').focus();await page.keyboard.press('Shift+Tab');assert.equal(await edit.evaluate(d=>d.contains(document.activeElement)),true);await page.keyboard.press('Tab');assert.equal(await edit.evaluate(d=>d.contains(document.activeElement)),true);await page.locator('#vCode').fill('999');await page.keyboard.press('Escape');await edit.waitFor({state:'hidden'});assert.equal(writes.length,0);assert.equal(await page.getByRole('dialog',{name:rows.vendors[299].short_name,exact:true}).isVisible(),true);
 await page.getByRole('button',{name:'修改廠商',exact:true}).click();assert.equal(await page.locator('#vCode').inputValue(),'300');await page.locator('#vCode').fill('999');await page.locator('#saveVendor').click();await edit.waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('detail').textContent.includes('999'));
 assert.equal(writes.length,1);assert.deepEqual(writes[0].filters,[['id',rows.vendors[299].id]]);assert.equal(writes[0].body.code,'999');await page.getByRole('button',{name:'修改',exact:true}).click();const site=page.getByRole('dialog',{name:'修改據點',exact:true});await site.waitFor();await page.locator('#sPhone').fill('000-000-0000');await page.locator('#saveSite').click();await site.waitFor({state:'hidden'});assert.equal(writes.length,2);assert.deepEqual(writes[1].filters,[['id','80000000-0000-4000-8000-000000000300']]);assert.equal(writes[1].body.vendor_id,rows.vendors[299].id);await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.dataset.id==='50000000-0000-4000-8000-000000000300');
},{viewport:{width:1280,height:900}}));
test('mobile 300-vendor list fits a narrow screen and opens a full-width scrollable sheet without moving the background', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 longVendorCatalog(rows);await page.goto(origin+'/vendors/index.html');await page.waitForFunction(()=>document.querySelectorAll('#grid [data-id]').length===300);const last=page.locator('#grid [data-id]').last();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.ok((await page.locator('#newVendor').boundingBox()).height<=56,'mobile toolbar labels stay horizontal and readable');assert.ok((await last.boundingBox()).height>=44);assert.ok((await last.boundingBox()).height<=64);
 if(process.env.VENDOR_LIST_SCREENSHOT_DIR)await page.screenshot({path:process.env.VENDOR_LIST_SCREENSHOT_DIR+'/mobile-list.png'});
 await last.scrollIntoViewIfNeeded();const before=await page.evaluate(()=>scrollY);await last.tap();const dialog=page.getByRole('dialog',{name:rows.vendors[299].short_name,exact:true});await dialog.waitFor();const rect=await dialog.boundingBox();assert.ok(Math.abs(rect.x)<=1&&Math.abs(rect.width-375)<=1);assert.ok(rect.y>=0&&rect.y+rect.height<=814);assert.equal(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth),true);
 await page.evaluate(()=>{window.__vendorScrollEnded=new Promise(resolve=>document.getElementById('detail').addEventListener('scrollend',resolve,{once:true}))});const scroll=await page.locator('#detail').boundingBox();const session=await page.context().newCDPSession(page);const x=Math.round(scroll.x+scroll.width/2),start=Math.round(Math.min(scroll.y+scroll.height-40,730));await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start}]});for(let y=start-30;y>Math.max(scroll.y+30,start-280);y-=40)await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();await page.evaluate(()=>window.__vendorScrollEnded.then(()=>true));await page.waitForFunction(()=>document.getElementById('detail').scrollTop>0);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1);
 await page.locator('#closeDetail').tap();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement?.dataset.id==='50000000-0000-4000-8000-000000000300');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-before)<=1);assert.equal(writes.length,0);
 if(process.env.VENDOR_LIST_SCREENSHOT_DIR){await page.locator('#grid [data-id]').nth(298).tap();await page.screenshot({path:process.env.VENDOR_LIST_SCREENSHOT_DIR+'/mobile-details.png'});}
},{viewport:{width:375,height:812},isMobile:true,hasTouch:true,deviceScaleFactor:1}));
test('300-vendor search and scope survive hide and restore without reopening closed details or changing identity', {timeout:30000},()=>fixture(async({page,origin,rows,writes})=>{
 longVendorCatalog(rows);await page.goto(origin+'/vendors/index.html');await page.locator('#search').fill('合成廠商 299');const row=page.locator('#grid [data-id]');await row.first().waitFor();assert.equal(await row.count(),1);const id=await row.getAttribute('data-id');
 await row.click();await page.locator('#toggleHidden').click();await page.waitForFunction(()=>!document.querySelector('#grid [data-id]'));assert.equal(await page.getByRole('dialog',{name:'合成廠商 299',exact:true}).isVisible(),true);await page.locator('#closeDetail').click();await page.waitForFunction(()=>document.activeElement?.id==='vendorScope');
 assert.equal(await page.locator('#search').inputValue(),'合成廠商 299');await page.getByLabel('廠商清單').selectOption('hidden');await row.waitFor();assert.equal(await row.getAttribute('data-id'),id);await row.click();await page.locator('#toggleHidden').click();await page.waitForFunction(()=>!document.querySelector('#grid [data-id]'));await page.locator('#closeDetail').click();
 for(const scope of ['all','active','hidden','all']){await page.getByLabel('廠商清單').selectOption(scope);assert.equal(await page.locator('#search').inputValue(),'合成廠商 299');assert.equal(await page.locator('#detailDialog').isVisible(),false);assert.equal(await row.count(),scope==='hidden'?0:1)}
 await page.locator('#search').fill('');assert.equal(await row.count(),300);assert.deepEqual((await row.evaluateAll(items=>items.map(r=>r.dataset.id))).slice(0,3),['50000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003']);
 assert.deepEqual(writes.map(w=>w.filters),[[['id',id]],[['id',id]]]);assert.deepEqual(writes.map(w=>w.body),[{is_hidden:true},{is_hidden:false}]);
}));
