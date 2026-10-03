// Lightweight real Auth + PostgREST + native PostgreSQL. No remote configuration accepted.
// SMTP is an in-memory loopback mail sink; business SQL is the actual rebuild manifest.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve,extname,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {randomBytes,createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright-core';
import {manifest,verifyManifest} from './rebuild/replay.mjs';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const bin=process.env.LONGEVITY_PG_BIN;assert.ok(bin&&isAbsolute(bin),'LONGEVITY_PG_BIN must be installed native PostgreSQL bin');
const work=mkdtempSync(join(tmpdir(),'factory-real-auth-')),data=join(work,'pg'),socket=join(work,'socket');mkdirSync(socket);
const secret=randomBytes(48).toString('hex'),name='factory-auth-'+randomBytes(6).toString('hex');
const containers=[],mail=[];let started=false,browser,origin,apiBase;
const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{input,encoding:'utf8',timeout:30000,maxBuffer:2e6});if(r.status!==0)throw Error(cmd.split('/').at(-1)+' failed: '+(r.stderr||'').replaceAll(secret,'[synthetic secret]'));return r.stdout.trim()};
const pg=(cmd,args,input)=>run(join(bin,cmd),args,input);
const listen=server=>new Promise(r=>server.listen(0,'127.0.0.1',()=>r(server.address().port)));
const port=async()=>{const s=netServer();const p=await listen(s);await new Promise(r=>s.close(r));return p};
const pgPort=await port(),authPort=await port(),restPort=await port();
const sql=text=>pg('psql',['-X','-qAt','-h',socket,'-p',String(pgPort),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],text);
const jwt=role=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify({role,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return h+'.'+p+'.'+createHmac('sha256',secret).update(h+'.'+p).digest('base64url')};
const anon=jwt('anon'),service=jwt('service_role');
const smtp=netServer(c=>{c.setEncoding('utf8');c.write('220 localhost ESMTP\r\n');let buffer='',body=null;
 c.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
  if(body!==null){if(line==='.'){mail.push(body);body=null;c.write('250 accepted\r\n')}else body+=line+'\r\n';continue}
  if(/^EHLO|^HELO/.test(line))c.write('250 localhost\r\n');else if(/^DATA/.test(line)){body='';c.write('354 end with dot\r\n')}else if(/^QUIT/.test(line)){c.end('221 bye\r\n')}else c.write('250 OK\r\n');
 }});
});
const proxy=httpServer(async(req,res)=>{
 try{const u=new URL(req.url,apiBase);const target=u.pathname.startsWith('/auth/v1/')?`http://127.0.0.1:${authPort}`+u.pathname.slice(8)+u.search:u.pathname.startsWith('/rest/v1/')?`http://127.0.0.1:${restPort}`+u.pathname.slice(8)+u.search:null;
  if(!target){res.writeHead(404).end();return}
  const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];let body='';for await(const c of req)body+=c;
  const r=await fetch(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body,redirect:'manual'});
  res.statusCode=r.status;for(const [k,v] of r.headers)if(!['transfer-encoding','content-length','content-encoding','connection'].includes(k))res.setHeader(k,v);res.end(Buffer.from(await r.arrayBuffer()));
 }catch{res.writeHead(502).end('isolated proxy error')}
});
const sdk=readFileSync(resolve(require.resolve('supabase-browser-sdk'),'../umd/supabase.js'),'utf8')+'\nexport const createClient=supabase.createClient;';
const site=httpServer(async(req,res)=>{
 const p=new URL(req.url,'http://127.0.0.1').pathname;
 if(p==='/config.local.js'){res.setHeader('Content-Type','text/javascript');return res.end('export default '+JSON.stringify({supabaseUrl:apiBase,supabaseKey:anon,storageBucket:'factory-photos-test'}))}
 const file=resolve(root,'.'+p+(p.endsWith('/')?'index.html':''));if(!file.startsWith(root+'/'))return res.writeHead(403).end();
 try{res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':'text/html');res.end(await readFile(file))}catch{res.writeHead(404).end()}
});
const wait=async check=>{const end=Date.now()+20000;while(Date.now()<end){try{if(await check())return}catch{}await new Promise(r=>setTimeout(r,100))}throw Error('local service/readiness timeout')};
const auth=async(path,body,token=service)=>{const r=await fetch(apiBase+'/auth/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.ok,true,'Auth '+path+' HTTP '+r.status);return r.json()};
const mailLink=async offset=>{await wait(()=>mail.length>offset);const decoded=mail.at(-1).replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/g,(_,x)=>String.fromCharCode(parseInt(x,16))).replaceAll('&amp;','&');const link=decoded.match(/href="([^"]+)"/)?.[1];assert.ok(link,'SMTP mail includes link');assert.equal(new URL(link).origin,apiBase);return link};
const clock=performance.now();
try{
 const smtpPort=await listen(smtp);apiBase='http://127.0.0.1:'+await listen(proxy);origin='http://127.0.0.1:'+await listen(site);
 pg('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);pg('pg_ctl',['-D',data,'-l',join(work,'pg.log'),'-o',`-k ${socket} -h 127.0.0.1 -p ${pgPort}`,'-w','start']);started=true;
 sql('create role supabase_auth_admin login;create schema auth authorization supabase_auth_admin;alter role supabase_auth_admin set search_path=auth;grant create on database postgres to supabase_auth_admin;');
 const env={GOTRUE_API_HOST:'127.0.0.1',GOTRUE_API_PORT:authPort,API_EXTERNAL_URL:apiBase+'/auth/v1',GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin@127.0.0.1:${pgPort}/postgres?sslmode=disable`,GOTRUE_DB_NAMESPACE:'auth',GOTRUE_SITE_URL:origin+'/board/',GOTRUE_URI_ALLOW_LIST:origin+'/account/,'+origin+'/board/',GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'false',GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:smtpPort,GOTRUE_SMTP_ADMIN_EMAIL:'test@example.invalid',GOTRUE_SMTP_SENDER_NAME:'Synthetic local test',GOTRUE_SMTP_MAX_FREQUENCY:'1ms',GOTRUE_RATE_LIMIT_EMAIL_SENT:100,GOTRUE_MAILER_URLPATHS_RECOVERY:'/auth/v1/verify',GOTRUE_MAILER_URLPATHS_CONFIRMATION:'/auth/v1/verify',GOTRUE_MAILER_URLPATHS_INVITE:'/auth/v1/verify',GOTRUE_PASSWORD_MIN_LENGTH:8,GOTRUE_MAILER_OTP_EXP:3600};
 const start=(suffix,image,environment)=>{const file=join(work,suffix+'.env');writeFileSync(file,Object.entries(environment).map(([k,v])=>k+'='+v).join('\n'),{mode:0o600});const container=name+'-'+suffix;run('docker',['run','-d','--name',container,'--network','host','--env-file',file,image]);containers.push(container)};
 start('auth','supabase/gotrue:v2.196.0@sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232',env);await wait(async()=> (await fetch(apiBase+'/auth/v1/health')).ok);
 let contract=readFileSync(join(root,'tests/rebuild/platform-contract.sql'),'utf8').replace('create schema auth;','').replace('create table auth.users(id uuid primary key, email text);','').replace("nullif(current_setting('request.jwt.claim.sub',true),'')::uuid","coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid");
 contract=contract.replace('create function auth.uid()', 'create or replace function auth.uid()');
 sql(contract);verifyManifest();for(const m of manifest.migrations)sql(readFileSync(join(root,'database/rebuild',m.file),'utf8'));
 start('rest','postgrest/postgrest:v14.17@sha256:c9dc201e555f5d8e37e7f39cdd4df0229774996e213bfd7de8d10ac609030f2c',{PGRST_DB_URI:`postgres://postgres@127.0.0.1:${pgPort}/postgres`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',PGRST_JWT_SECRET:secret,PGRST_SERVER_HOST:'127.0.0.1',PGRST_SERVER_PORT:restPort});await wait(async()=> (await fetch(apiBase+'/rest/v1/')).ok);
 const email='weekend@example.invalid';sql(`insert into public.allowed_emails(email,role) values('${email}','admin');`);const user=await auth('/admin/users',{email,email_confirm:true});assert.ok(user.id);
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'/usr/bin/chromium',headless:true});
 const context=await browser.newContext(),errors=[],blocked=[];await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='esm.sh')return route.fulfill({contentType:'text/javascript',body:sdk});if([origin,apiBase].includes(u.origin))return route.continue();blocked.push(u.hostname);return route.abort()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.url().includes('/rest/v1/')&&r.status()>=400){const e=await r.json().catch(()=>({}));console.log('REST diagnostic '+JSON.stringify({status:r.status(),code:e.code,message:e.message}));}});
 await page.goto(origin+'/account/');await page.locator('#email').fill(email);let offset=mail.length;await page.locator('#sendReset').click();const link=await mailLink(offset);
 await page.goto(link);await page.waitForURL(origin+'/account/**');await page.locator('#passwordForm').waitFor({timeout:5000}).catch(async()=>{throw Error('Password form unavailable: '+await page.locator('#message').innerText())});await page.locator('#password').fill('Synthetic-first-123!');await page.reload();await page.locator('#passwordForm').waitFor({timeout:5000}).catch(async()=>{throw Error('Password form unavailable: '+await page.locator('#message').innerText())});assert.equal(await page.locator('#password').inputValue(),'');
 const password='Synthetic-'+randomBytes(12).toString('hex')+'!';await page.locator('#password').fill(password);await page.locator('#confirmPassword').fill(password);await page.locator('#savePassword').click();await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('密碼已更新'));
 console.log('PASS real SMTP recovery link, persisted interrupted session, updateUser and local signout');
 await page.goto(origin+'/board/');await page.locator('#loginEmail').fill(email);await page.locator('#loginPassword').fill('Wrong-synthetic-password');await page.locator('#loginBtn').click();await page.waitForFunction(()=>document.querySelector('#authMsg').textContent.includes('登入未成功'));
 await page.locator('#loginPassword').fill(password);await page.locator('#loginBtn').click();await page.locator('#appMain').waitFor();await page.goto(origin+'/vendors/');await page.locator('#app').waitFor();
 console.log('PASS real password rejection/retry, profile RLS/admin gate and cross-page session persistence');
 const login=await auth('/token?grant_type=password',{email,password},anon);const payload=[{code:'REAL',short_name:'Real isolated import',is_active:true}];
 const rpc=async token=>{const r=await fetch(apiBase+'/rest/v1/rpc/import_vendor_workbook',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({p_rows:payload})});return {status:r.status,body:await r.json()}};
 const results=await Promise.all([rpc(login.access_token),rpc(login.access_token)]);assert.deepEqual(results.map(x=>x.body.added).sort(),[0,1]);assert.ok([401,403].includes((await rpc(anon)).status));
 sql(`update public.profiles set role='staff' where user_id='${user.id}';`);assert.equal((await rpc(login.access_token)).status,403);sql(`update public.profiles set role='admin' where user_id='${user.id}';`);
 console.log('PASS real PostgREST concurrent import dedupe, anonymous and staff denial with actual JWT');
 await page.goto(origin+'/account/');await page.locator('#passwordForm').waitFor();
 const changed='Synthetic-'+randomBytes(12).toString('hex')+'!';
 await page.route('**/auth/v1/user',async route=>{if(route.request().method()!=='PUT')return route.continue();await route.fetch();await route.abort('failed')});
 await page.locator('#password').fill(changed);await page.locator('#confirmPassword').fill(changed);await page.locator('#savePassword').click();
 await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('未確認'));await page.unroute('**/auth/v1/user');assert.equal(await page.locator('#password').inputValue(),'');
 assert.ok((await auth('/token?grant_type=password',{email,password:changed},anon)).access_token);
 console.log('PASS real committed password change with lost response: uncertainty shown, inputs cleared, new password works');
 await page.goto(origin+'/account/');await page.locator('#cancelReset').click();await page.locator('#requestForm').waitFor();await page.locator('#email').fill(email);offset=mail.length;await page.locator('#sendReset').click();const expired=await mailLink(offset);sql(`update auth.users set recovery_sent_at=now()-interval '2 hours' where id='${user.id}';`);
 await page.goto(expired);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('過期'));await page.locator('#requestForm').waitFor();assert.match(await page.locator('#message').innerText(),/過期/);assert.equal(await page.locator('#passwordForm').isVisible(),false);
 await page.locator('#email').fill(email);offset=mail.length;await page.locator('#sendReset').click();const fresh=await mailLink(offset);await page.goto(fresh);await page.locator('#passwordForm').waitFor({timeout:5000}).catch(async()=>{throw Error('Password form unavailable: '+await page.locator('#message').innerText())});await page.locator('#cancelReset').click();await page.locator('#requestForm').waitFor();await page.goto(fresh);await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('過期'));await page.locator('#requestForm').waitFor();assert.equal(await page.locator('#passwordForm').isVisible(),false);
 console.log('PASS real expired recovery, resend retry, cancellation and used-link rejection');
 await page.goto(origin+'/board/');await page.locator('#loginEmail').fill(email);offset=mail.length;await page.locator('#magicLinkBtn').click();const magic=await mailLink(offset);await page.goto(magic);await page.locator('#appMain').waitFor();
 console.log('PASS original magic-link fallback with real SMTP and Auth');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);console.log('REAL AUTH/POSTGREST PASS '+JSON.stringify({auth:'2.196.0',postgrest:'14.17',sdk:'2.116.0',wallSeconds:(performance.now()-clock)/1000}));
}finally{
 await browser?.close();for(const c of containers.reverse())run('docker',['rm','-f',c]);
 for(const server of [site,proxy,smtp]){server.closeAllConnections?.();await new Promise(r=>server.close(r))}
 if(started)pg('pg_ctl',['-D',data,'-m','fast','-w','stop']);rmSync(work,{recursive:true,force:true});
}
