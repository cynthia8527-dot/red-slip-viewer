// Optional local PostgreSQL cross-connection proof. No connection URL accepted.
// Owns a new temporary cluster, Unix socket only; never uses Supabase/Docker.
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,rmSync } from 'node:fs';
import { join,resolve,isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { manifest,verifyManifest } from '../rebuild/replay.mjs';
const bin=process.env.LONGEVITY_PG_BIN;
assert.ok(bin&&isAbsolute(bin),'Set LONGEVITY_PG_BIN to an installed PostgreSQL bin directory');
const work=mkdtempSync(join(tmpdir(),'red-slip-import-')),data=join(work,'data'),socket=join(work,'socket');mkdirSync(socket);
const port='55440', sessions=[];let started=false;
const command=(name,args,input)=>{
  const r=spawnSync(join(bin,name),args,{input,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  assert.equal(r.status,0,`${name}: ${r.stderr||r.stdout}`);return r.stdout;
};
const psqlArgs=['-X','-qAt','-v','ON_ERROR_STOP=1','-h',socket,'-p',port,'-U','postgres','-d','postgres'];
const sql=text=>command('psql',psqlArgs,text);
function connection(name) {
  const proc=spawn(join(bin,'psql'),psqlArgs,{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
  let pending=null,stdout='',stderr='',closed=false,serial=0;
  proc.stdout.on('data',b=>{stdout+=b; if(pending&&stdout.includes(pending.marker)) {const {resolve,marker}=pending;pending=null;const result=stdout.split(marker)[0].trim();stdout='';resolve(result);} });
  proc.stderr.on('data',b=>stderr+=b);
  proc.on('exit',()=>{closed=true;if(pending){pending.reject(new Error(stderr));pending=null;} });
  const query=text=>{
    assert.ok(!pending,'one pending command per session');assert.ok(!closed,'session closed');
    const marker=`DONE_${++serial}`;
    const promise=new Promise((resolve,reject)=>{pending={resolve,reject,marker};proc.stdin.write(text+'\n\\echo '+marker+'\n');});
    promise.catch(()=>{});return promise;
  };
  const result={query,close:()=>proc.stdin.end(),proc};sessions.push(result);return result;
}
async function waitForLock(name) {
  const deadline=Date.now()+5000;
  while(Date.now()<deadline) {
    if(sql(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event_type='Lock';`).trim()==='1')return;
    await new Promise(r=>setTimeout(r,20));
  }
  throw new Error(name+' did not actually block on a PostgreSQL lock');
}
const admin='40000000-0000-4000-8000-000000000001';
const rows=[{code:'A',short_name:'總廠',invoice_title:'Company',tax_id:'001',is_active:true},{code:'A-P2',short_name:'二廠',invoice_title:'Company',tax_id:'001',is_active:true}];
const invoke = rows => `select public.import_vendor_workbook('${JSON.stringify(rows)}'::jsonb);`;
const auth = `select set_config('request.jwt.claim.sub','${admin}',false);set role authenticated;`;
const clock=performance.now();
try {
 command('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 command('pg_ctl',['-D',data,'-l',join(work,'server.log'),'-o',`-k ${socket} -h '' -p ${port}`,'-w','start']);started=true;
 console.log('NATIVE '+command('postgres',['--version']).trim());
 verifyManifest();sql(readFileSync(new URL('../rebuild/platform-contract.sql',import.meta.url),'utf8'));
 for(const e of manifest.migrations)sql(readFileSync(resolve('database/rebuild',e.file),'utf8'));
 sql(`insert into auth.users values('${admin}','import@example.invalid');insert into public.profiles(user_id,email,role,active) values('${admin}','import@example.invalid','admin',true);`);
 const a=connection('import_first'),b=connection('import_retry');await a.query(auth);await b.query(auth);
 assert.equal(JSON.parse(await a.query('begin;'+invoke(rows))).added,1);
 const retry=b.query(invoke(rows));await waitForLock('import_retry');await a.query('commit;');
 assert.deepEqual(JSON.parse(await retry),{added:0,site_added:0,skipped:2,total:2});
 console.log('PASS actual overlapping imports: second blocks then skips parent/site');
 const newRows=rows.map(r=>({...r,code:r.code+'B',tax_id:'002'}));
 await a.query('begin;'+invoke(newRows));const resumed=b.query(invoke(newRows));await waitForLock('import_retry');await a.query('rollback;');
 assert.deepEqual(JSON.parse(await resumed),{added:1,site_added:1,skipped:0,total:2});
 console.log('PASS rollback while retry waits: second imports entire workbook once');
 await a.query('begin;lock table public.vendors in share row exclusive mode;');
 const timed=b.query(invoke([{code:'timeout',short_name:'timeout',is_active:true}]));await waitForLock('import_retry');
 await assert.rejects(timed,/lock timeout/);await a.query('rollback;');
 assert.equal(sql("select count(*) from public.vendors where code='timeout';").trim(),'0');
 console.log('PASS 5-second lock timeout leaves no partial import');
 const c=connection('import_after_manual');await c.query(auth);
 await a.query("begin;insert into public.vendors(code,short_name) values('MANUAL','Manual');");
 const manual=c.query(invoke([{code:'MANUAL',short_name:'Manual',is_active:true}]));await waitForLock('import_after_manual');await a.query('commit;');
 assert.equal(JSON.parse(await manual).skipped,1);console.log('PASS earlier manual write commits before deduplication');
 const many=Array.from({length:5000},(_,i)=>({code:'V'+i,short_name:'Volume '+i,is_active:true}));
 const startedAt=performance.now();const result=JSON.parse(await c.query(invoke(many)));assert.equal(result.added,5000);
 assert.equal(JSON.parse(await c.query(invoke(many))).skipped,5000);
 console.log('PASS 5000 vendors plus 5000 retry rows '+JSON.stringify({wallSeconds:(performance.now()-startedAt)/1000}));
 console.log('IMPORT NATIVE PASS '+JSON.stringify({wallSeconds:(performance.now()-clock)/1000}));
} finally {
 for(const s of sessions)s.close();if(started)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);rmSync(work,{recursive:true,force:true});
}
