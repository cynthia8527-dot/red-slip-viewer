import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {rebuild} from './rebuild/replay.mjs';
import * as XLSX from 'xlsx';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Real HTML, XLSX decoder and SQL for imports. Auth is an explicit double.
const root=resolve(import.meta.dirname,'..'),uid='40000000-0000-4000-8000-000000000001';
const sdk=`export function createClient(){
 let callback=()=>{};const session=()=>localStorage.getItem('test-session')?{user:{id:'${uid}',email:'synthetic@example.invalid'},access_token:'synthetic'}:null;
 window.authCalls=[];
 const auth={
  getSession:async()=>({data:{session:session()}}),getUser:async()=>({data:{user:session()?.user}}),
  onAuthStateChange:fn=>{callback=fn;window.emitAuth=fn;return {data:{subscription:{unsubscribe(){}}}}},
  signOut:async()=>{localStorage.removeItem('test-session');callback('SIGNED_OUT');return {}},
  signInWithPassword:async()=>{window.authCalls.push('password');await new Promise(r=>setTimeout(r,60));if(window.failLogin)return {error:{message:'invalid'}};localStorage.setItem('test-session','yes');return {}},
  signInWithOtp:async args=>{window.authCalls.push({otp:args});return {}},
  resetPasswordForEmail:async(email,args)=>{window.authCalls.push({reset:args});if(window.failReset)return {error:{message:'rate limit'}};return {}},
  updateUser:async()=>{window.authCalls.push('update');if(window.failUpdate)return {error:{message:'expired'}};return {}}
 };
 return {auth,from(table){let cursor='';const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,gt:(_k,v)=>{cursor=v;return q},
 maybeSingle:async()=>({data:{role:window.staff?'staff':'admin',active:!window.inactive,email:'synthetic@example.invalid'}}),
 then:async done=>done({data:(await(await fetch('/test/rows/'+table)).json()).filter(r=>r.id>cursor),error:null})};return q},
 rpc:async(name,args)=>{try{const r=await fetch('/test/rpc/'+name,{method:'POST',body:JSON.stringify(args)});const d=await r.json();return r.ok?{data:d}:{error:d}}catch{return {error:{message:'response lost'}}}}
 };
}`;
async function harness(fn){
 const db=await rebuild();let browser;
 const state={loseImport:false,imports:0,shipments:[]};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  if(path==='/config.local.js'){res.setHeader('Content-Type','text/javascript');return res.end("export default {supabaseUrl:'http://127.0.0.1:54321',supabaseKey:'test-only',storageBucket:'factory-photos-test'}")}
  if(path.startsWith('/test/rows/')){const table=path.split('/').at(-1);assert.ok(['vendors','vendor_sites','products','vendor_prices','shipment_photos'].includes(table));return res.end(JSON.stringify((await db.query('select * from public.'+table+' order by id')).rows))}
  if(path==='/test/rpc/import_vendor_workbook'){
   state.imports++;let body='';for await(const chunk of req)body+=chunk;
   try{const {rows}=await db.query('select public.import_vendor_workbook($1::jsonb) result',[JSON.stringify(JSON.parse(body).p_rows)]);
    if(state.loseImport){state.loseImport=false;res.statusCode=502;return res.end(JSON.stringify({message:'injected gateway lost success response'}))}
    return res.end(JSON.stringify(rows[0].result));
   }catch(e){res.statusCode=400;return res.end(JSON.stringify({message:e.message}))}
  }
  const file=resolve(root,'.'+path+(path.endsWith('/')?'index.html':''));if(!file.startsWith(root+sep)){res.writeHead(403).end();return}
  try{const body=await readFile(file);res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'text/html');res.end(body)}catch{res.writeHead(404).end()}
 });
 try{
  await db.query("insert into auth.users values($1,'synthetic@example.invalid')",[uid]);await db.query("insert into public.profiles(user_id,email,role,active) values($1,'synthetic@example.invalid','admin',true)",[uid]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);await db.exec('set role authenticated');
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
  const context=await browser.newContext({timezoneId:'America/Los_Angeles'}),errors=[],blocked=[];
  await context.route('**/*',route=>{const u=new URL(route.request().url());
   if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});
   if(u.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',path:require.resolve('xlsx/xlsx.mjs')});
   if(u.origin===origin)return route.continue();
   if(u.origin==='http://127.0.0.1:54321'&&u.pathname==='/functions/v1/shipments')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization'},body:JSON.stringify({shipments:state.shipments})});
   blocked.push(u.hostname);return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await fn({page,context,origin,db,state});assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));await db.close()}
}
test('browser import lost response and reload retry: real SQL leaves exactly one company/site', {timeout:60000},()=>harness(async({page,origin,db,state})=>{
 await page.goto(origin+'/vendors/');await page.evaluate(()=>localStorage.setItem('test-session','yes'));await page.reload();await page.locator('#app').waitFor();
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['代碼','簡稱'],['A','總廠','Company',null,'001'],['A-P2','二廠','Company',null,'001']]),'客戶-通訊錄');
 const file={name:'synthetic.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})};
 state.loseImport=true;await page.locator('#importExcel').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#importState').textContent.includes('未取得'),null,{timeout:5000}).catch(async e=>{throw new Error((await page.locator('#importState').innerText())+' | '+e.message)});
 assert.equal((await db.query('select count(*)::int n from public.vendors')).rows[0].n,1);
 await page.reload();await page.locator('#app').waitFor();await page.locator('#importExcel').setInputFiles(file);await page.waitForFunction(()=>document.querySelector('#importState').textContent.includes('匯入完成'));
 assert.match(await page.locator('#importState').innerText(),/新增 0 家廠商、0 個據點；略過 2/);
 assert.equal((await db.query('select count(*)::int n from public.vendor_sites')).rows[0].n,1);assert.equal(state.imports,2);
}));
test('browser password/fallback/reset interruption, expiry, retry and navigation (Auth double)',{timeout:60000},()=>harness(async({page,origin})=>{
 await page.goto(origin+'/board/');await page.locator('#loginEmail').fill('synthetic@example.invalid');await page.locator('#loginPassword').fill('Synthetic-only-123');
 await page.evaluate(()=>window.failLogin=true);await page.locator('#loginBtn').click();await page.waitForFunction(()=>document.querySelector('#authMsg').textContent.includes('登入未成功'));assert.equal(await page.locator('#loginPassword').inputValue(),'');
 await page.locator('#magicLinkBtn').click();await page.waitForFunction(()=>document.querySelector('#authMsg').textContent.includes('若此 Email'));assert.equal(await page.evaluate(()=>window.authCalls.at(-1).otp.options.emailRedirectTo),origin+'/board/');
 await page.evaluate(()=>window.failLogin=false);await page.locator('#loginPassword').fill('Synthetic-only-123');await page.locator('#loginBtn').evaluate(b=>{b.click();b.click()});await page.locator('#appMain').waitFor();
 assert.equal(await page.evaluate(()=>window.authCalls.filter(x=>x==='password').length),2);
 await page.goto(origin+'/vendors/');await page.locator('#app').waitFor();await page.goto(origin+'/board/');await page.locator('#appMain').waitFor();await page.locator('#logoutBtn').click();await page.locator('#authGate').waitFor();
 await page.goto(origin+'/account/#error=access_denied&error_code=otp_expired&error_description=SECRET_NOT_DISPLAYED');await page.locator('#requestForm').waitFor();assert.match(await page.locator('#message').innerText(),/過期/);assert.ok(!(await page.locator('body').innerText()).includes('SECRET_NOT_DISPLAYED'));assert.equal(new URL(page.url()).hash,'');
 await page.locator('#email').fill('synthetic@example.invalid');await page.evaluate(()=>window.failReset=true);await page.locator('#sendReset').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('暫時無法寄送'));
 await page.evaluate(()=>window.failReset=false);await page.locator('#sendReset').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('將收到驗證信'));assert.equal(await page.evaluate(()=>window.authCalls.at(-1).reset.redirectTo),origin+'/account/');
 // A synthetic verified recovery session, persisted as the SDK would persist it.
 await page.evaluate(()=>localStorage.setItem('test-session','yes'));await page.reload();await page.locator('#passwordForm').waitFor();
 await page.locator('#password').fill('Synthetic-new-456');await page.locator('#confirmPassword').fill('Does-not-match');await page.locator('#savePassword').click();assert.match(await page.locator('#message').innerText(),/不一致/);
 await page.reload();await page.locator('#passwordForm').waitFor();assert.equal(await page.locator('#password').inputValue(),'');assert.equal(await page.evaluate(()=>window.authCalls.length),0,'reload never writes password');
 await page.evaluate(()=>window.failUpdate=true);await page.locator('#password').fill('Synthetic-new-456');await page.locator('#confirmPassword').fill('Synthetic-new-456');await page.locator('#savePassword').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('未確認'));assert.equal(await page.locator('#password').inputValue(),'');
 await page.evaluate(()=>window.failUpdate=false);await page.locator('#password').fill('Synthetic-new-456');await page.locator('#confirmPassword').fill('Synthetic-new-456');await page.locator('#savePassword').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('密碼已更新'));
 assert.equal(await page.evaluate(()=>localStorage.getItem('test-session')),null);await page.getByRole('link',{name:'返回登入／貨件系統'}).click();await page.locator('#authGate').waitFor();
}));
test('browser shipped filter uses Taipei year/month and current-month button after year rollover',{timeout:60000},()=>harness(async({page,origin,state})=>{
 state.shipments=[{id:'s1',vendor_name:'Synthetic',item_name:'New year Taipei',status:'已出貨',shipped_at:'2027-12-31T16:00:00Z'},{id:'s2',vendor_name:'Synthetic',item_name:'Previous year',status:'已出貨',shipped_at:'2027-12-31T15:59:59Z'}];
 await page.clock.setFixedTime(new Date('2027-12-31T15:00:00Z'));await page.goto(origin+'/board/');await page.evaluate(()=>localStorage.setItem('test-session','yes'));await page.reload();await page.locator('#appMain').waitFor();await page.locator('[data-tab="shipped"]').click();
 await page.waitForFunction(()=>document.querySelector('#tbody').textContent.includes('Previous year'));assert.ok(!(await page.locator('#tbody').innerText()).includes('New year Taipei'));
 await page.clock.setFixedTime(new Date('2027-12-31T16:00:01Z'));await page.locator('#currentShipMonth').click();assert.equal(await page.locator('#shipYear').inputValue(),'2028');assert.equal(await page.locator('#shipMonth').inputValue(),'01');assert.match(await page.locator('#tbody').innerText(),/New year Taipei/);assert.ok(!(await page.locator('#tbody').innerText()).includes('Previous year'));
 await page.locator('#allShipDates').click();assert.match(await page.locator('#tbody').innerText(),/Previous year/);
 await page.clock.setFixedTime(new Date('2028-01-31T15:59:59Z'));await page.locator('#currentShipMonth').click();
 await page.clock.setFixedTime(new Date('2028-01-31T16:00:00Z'));await page.locator('#reload').click();
 await page.waitForFunction(()=>document.querySelector('#shipMonth').value==='02');
 await page.locator('#shipMonth').selectOption('01');await page.clock.setFixedTime(new Date('2028-02-29T16:00:00Z'));await page.locator('#reload').click();
 await page.waitForFunction(()=>document.querySelector('#loading').style.display==='none');assert.equal(await page.locator('#shipMonth').inputValue(),'01','explicit historical month stays selected across rollover');
}));
test('browser active-role gate, recovery navigation and cancel never submit a password',{timeout:60000},()=>harness(async({page,origin,context})=>{
 await page.goto(origin+'/board/');await page.evaluate(()=>window.inactive=true);await page.locator('#loginEmail').fill('synthetic@example.invalid');await page.locator('#loginPassword').fill('Synthetic-only-123');await page.locator('#loginBtn').click();
 await page.waitForFunction(()=>document.querySelector('#authMsg').textContent.includes('尚未被授權'));assert.equal(await page.evaluate(()=>localStorage.getItem('test-session')),null);assert.equal(await page.locator('#appMain').isVisible(),false);
 await page.evaluate(()=>{window.inactive=false;window.staff=true});await page.locator('#loginPassword').fill('Synthetic-only-123');await page.locator('#loginBtn').click();await page.locator('#appMain').waitFor();assert.equal(await page.evaluate(()=>document.body.classList.contains('isAdmin')),false);
 await page.evaluate(()=>window.emitAuth('PASSWORD_RECOVERY'));await page.waitForURL('**/account/');await page.locator('#passwordForm').waitFor();
 await page.locator('#password').fill('Synthetic-cancel-123');await page.locator('#cancelReset').click();await page.locator('#requestForm').waitFor();assert.equal(await page.evaluate(()=>window.authCalls.includes('update')),false);assert.equal(await page.locator('#password').inputValue(),'');
}));
