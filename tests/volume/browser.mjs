import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright-core';
export async function verifyVolumeBrowser({status,session}){
 const root=resolve(import.meta.dirname,'../..');
 const browserPath=[process.env.TEST_BROWSER_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].filter(Boolean).find(existsSync);
 assert.ok(browserPath,'Volume browser is required');
 const require=createRequire(import.meta.url);
 const sdkPath=resolve(require.resolve('@supabase/supabase-js'),'../umd/supabase.js');
 const sdk=readFileSync(sdkPath,'utf8')+'\nexport const createClient=supabase.createClient;';
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1').pathname;
  if(pathname==='/config.local.js'){
   res.writeHead(200,{'Content-Type':'text/javascript'});
   // Volume catalog contains no images; real Storage byte flows are tested separately.
   return res.end('export default '+JSON.stringify({supabaseUrl:status.API_URL,supabaseKey:status.ANON_KEY,storageBucket:'factory-photos-test'}));
  }
  const file=resolve(root,'.'+pathname);if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{const body=await readFile(file);res.writeHead(200,{'Content-Type':extname(file)==='.html'?'text/html':'text/javascript'});res.end(body);}catch{res.writeHead(404).end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try{
  browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-sandbox']});
  const context=await browser.newContext();
  const errors=[];context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
  await context.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:'sb-'+new URL(status.API_URL).hostname.split('.')[0]+'-auth-token',session});
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.hostname==='esm.sh'&&url.pathname.startsWith('/@supabase/supabase-js'))return route.fulfill({status:200,contentType:'text/javascript',body:sdk});
   if(['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
   errors.push('Unexpected nonlocal request host');return route.abort();
  });
  const page=await context.newPage();const start=performance.now();
  await page.goto(`http://127.0.0.1:${server.address().port}/board/index.html`);
  await page.waitForFunction(()=>document.getElementById('cActive').textContent==='2000',{},{timeout:45000});
  assert.equal(await page.locator('#cShipped').textContent(),'8000');
  const loadMs=Math.round(performance.now()-start);
  const searchStart=performance.now();await page.locator('#search').fill('Synthetic item 10000');
  await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody').textContent.includes('Synthetic item 10000'));
  const searchMs=Math.round(performance.now()-searchStart);
  await page.locator('#search').fill('Synthetic item 9999');
  await page.locator('[data-tab="shipped"]').click();await page.locator('#allShipDates').click();
  await page.waitForFunction(()=>document.querySelector('tbody').textContent.includes('Synthetic item 9999'));
  assert.match(await page.locator('tbody').textContent(),/864\.15/);
  await page.close();
  const pricePage=await context.newPage();const priceStart=performance.now();
  await pricePage.goto(`http://127.0.0.1:${server.address().port}/calculator/index.html`);
  const vendor=pricePage.locator('[data-vendor-id="b2000000-0000-4000-8000-000000000100"]');await vendor.waitFor({timeout:45000});await vendor.click();
  await pricePage.locator('#productSearch').fill('Synthetic product 03000');
  await pricePage.waitForFunction(()=>document.querySelectorAll('#grid .card').length===1&&document.getElementById('grid').textContent.includes('Synthetic product 03000'));
  assert.match(await pricePage.locator('#grid .price').textContent(),/100/);
  const priceMs=Math.round(performance.now()-priceStart);
  assert.deepEqual(errors,[]);
  console.log('VOLUME BROWSER '+JSON.stringify({shipments:10000,active:2000,shipped:8000,products:3000,board_load_ms:loadMs,search_last_ms:searchMs,catalog_load_and_search_ms:priceMs,real_local_api:true,sdk:'2.117.2',browser:browser.version()}));
  await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
