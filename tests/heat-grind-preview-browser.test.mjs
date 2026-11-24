import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';

const root=resolve(import.meta.dirname,'..');
async function fixture(run){
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=resolve(root,'.'+(path.endsWith('/')?path+'index.html':path));
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  try{res.setHeader('content-type',extname(file)==='.js'?'text/javascript':extname(file)==='.css'?'text/css':'text/html');res.end(await readFile(file))}catch{res.writeHead(404).end()}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
  const context=await browser.newContext({viewport:{width:375,height:760}}),errors=[],blocked=[],mutations=[];
  const origin=`http://127.0.0.1:${server.address().port}`;
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.origin===origin){if(!['GET','HEAD'].includes(req.method()))mutations.push(req.url());return route.continue()}
   if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.endsWith('pdf.min.js'))return route.fulfill({contentType:'text/javascript',body:'window.pdfjsLib={GlobalWorkerOptions:{}};'});
   if(url.hostname==='cdnjs.cloudflare.com'&&url.pathname.endsWith('xlsx.full.min.js'))return route.fulfill({contentType:'text/javascript',body:await readFile(resolve(root,'node_modules/xlsx/dist/xlsx.full.min.js'),'utf8')});
   blocked.push(req.url());return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(3000);page.on('pageerror',e=>errors.push(e.message));
  await run({page,origin});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(mutations,[]);await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r))}
}
async function openViewer(page,origin){
 await page.goto(origin+'/');await page.getByRole('link').filter({hasText:'紅單看片／校正'}).click();
 await page.waitForLoadState('load');
 await page.locator('#slipInput').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await page.getByRole('button',{name:'開始看片',exact:true}).click();await page.locator('#viewer').waitFor({state:'visible'});
}
test('home → red-slip preview gives review-only unit hints, preserves fields, and confirmed process wins on mobile', {timeout:30000},()=>fixture(async({page,origin})=>{
 await openViewer(page,origin);
 const fields={redNo:'SYNTHETIC-001',customer:'合成測試公司',item:'合成零件',weight:'12.50',unit:'桶',price:'61',notes:'合成備註'};
 for(const [id,value] of Object.entries(fields))await page.locator('#'+id).fill(value);
 await page.getByRole('button',{name:'預覽工法判讀',exact:true}).click();
 const result=page.getByRole('status',{name:'工法判讀結果'});await result.filter({hasText:'待確認'}).waitFor();assert.match(await result.innerText(),/研磨.*磁振/);assert.match(await result.innerText(),/待確認/);
 for(const [id,value] of Object.entries(fields))assert.equal(await page.locator('#'+id).inputValue(),value);
 assert.equal(await page.evaluate(()=>localStorage.getItem('redSlipViewerLogs')),null);
 await page.getByLabel('明寫／已確認工法').selectOption('熱處理');await page.getByRole('button',{name:'預覽工法判讀',exact:true}).click();await result.filter({hasText:'已確認：熱處理'}).waitFor();assert.match(await result.innerText(),/已確認.*熱處理/);
 assert.equal(await page.locator('#price').inputValue(),'61');assert.equal(await page.locator('#item').inputValue(),'合成零件');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
}));
test('editing source invalidates confirmation; explicit work and accounting apply stay separate from guesses and saved records', {timeout:30000},()=>fixture(async({page,origin})=>{
 await openViewer(page,origin);
 const result=page.getByRole('status',{name:'工法判讀結果'}),preview=page.getByRole('button',{name:'預覽工法判讀',exact:true});
 await page.getByLabel('明寫／已確認工法').selectOption('熱處理');await preview.click();await result.filter({hasText:'已確認：熱處理'}).waitFor();
 await page.locator('#customer').fill('另一合成公司');assert.equal(await page.getByLabel('明寫／已確認工法').inputValue(),'');assert.match(await result.innerText(),/尚未預覽/);
 await page.locator('#unit').fill('原帳未註');await page.locator('#price').fill('999');await preview.click();await result.filter({hasText:'待確認'}).waitFor();assert.match(await result.innerText(),/不以價格高低猜配/);
 await page.locator('#item').fill('磁振');await preview.click();await result.filter({hasText:'明寫工法：磁振'}).waitFor();
 const XLSX=await import('xlsx'),book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['紅單號','客戶','品名','重量','單位','單價'],['SYNTHETIC-002','合成丙','合成零件','8','批','23']]),'合成會計');
 await page.locator('#excelInput').setInputFiles({name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
 await page.locator('#status').filter({hasText:'已讀取 2 列'}).waitFor();await page.locator('#redNo').fill('SYNTHETIC-002');await page.getByRole('button',{name:'用紅單號找會計答案'}).click();
 await page.getByLabel('明寫／已確認工法').selectOption('研磨');await page.getByRole('button',{name:'套用會計欄位',exact:true}).click();
 assert.equal(await page.getByLabel('明寫／已確認工法').inputValue(),'');assert.match(await result.innerText(),/尚未預覽/);await preview.click();await result.filter({hasText:'批通常偏熱處理'}).waitFor();
 assert.equal(await page.locator('#price').inputValue(),'23');assert.equal(await page.locator('#unit').inputValue(),'批');assert.equal(await page.locator('#item').inputValue(),'合成零件');assert.equal(await page.evaluate(()=>localStorage.getItem('redSlipViewerLogs')),null);
}));
