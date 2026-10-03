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
const work=mkdtempSync(join(tmpdir(),'red-slip-locks-')),data=join(work,'data'),socket=join(work,'socket');mkdirSync(socket);
const port='55439', sessions=[];let started=false;
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
const id='20000000-0000-4000-8000-000000000001',key='20000000-0000-4000-8000-000000000010';
const old=`products/${id}/old.png`,fresh=`products/${id}/new.png`;
const create=`select public.create_shipment_idempotent('{"vendor_name":"Synthetic","item_name":"Synthetic","location":"蘆洲","status":"未開始","is_demo":false,"urgent":false,"cannot_mix":false}',null,'2028-01-01','${key}',repeat('a',64));`;
const clock=performance.now();
try {
  command('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
  command('pg_ctl',['-D',data,'-l',join(work,'server.log'),'-o',`-k ${socket} -h '' -p ${port}`,'-w','start']);started=true;
  console.log('NATIVE '+command('postgres',['--version']).trim());
  verifyManifest();
  sql(readFileSync(new URL('../rebuild/platform-contract.sql',import.meta.url),'utf8'));
  for(const entry of manifest.migrations)sql(readFileSync(resolve('database/rebuild',entry.file),'utf8'));
  sql(`insert into public.products(id,name,reference_photo_path) values('${id}','Synthetic','${old}');`);
  // A retires O but hasn't committed; B's real UPDATE must wait, then reject O.
  const a=connection('photo_claim_first'), b=connection('photo_relink_second');
  await a.query(`begin; update public.products set reference_photo_path='${fresh}' where id='${id}'; select public.claim_product_photo_cleanup('${id}','${old}');`);
  const late=b.query(`set statement_timeout='5s'; update public.products set reference_photo_path='${old}' where id='${id}';`);
  await waitForLock('photo_relink_second');await a.query('commit;');await assert.rejects(late,/path is retired/);
  assert.equal(sql(`select reference_photo_path from public.products where id='${id}';`).trim(),fresh);
  console.log('PASS claim first: blocked relink rejects retired path after COMMIT');
  // Reverse order: a live reference wins; cleanup claim must return false after waiting.
  const c=connection('photo_link_first'), d=connection('photo_cleanup_second');
  const newest=`products/${id}/third.png`;
  await c.query(`begin; update public.products set reference_photo_path='${newest}' where id='${id}';`);
  const cleanup=d.query(`set statement_timeout='5s'; select public.claim_product_photo_cleanup('${id}','${newest}');`);
  await waitForLock('photo_cleanup_second');await c.query('commit;');assert.equal(await cleanup,'f');
  console.log('PASS link first: cleanup waits then refuses referenced path');
  // A deletes while the original create request arrives on another connection.
  sql(create);
  const shipment=sql(`select id from public.shipments where create_request_id='${key}';`).trim();
  const e=connection('shipment_delete_first'), f=connection('shipment_retry_second');
  await e.query(`begin; delete from public.shipments where id='${shipment}';`);
  const retry=f.query(`set statement_timeout='5s'; ${create}`);
  await waitForLock('shipment_retry_second');await e.query('commit;');await assert.rejects(retry,/permanently deleted/);
  assert.equal(sql('select count(*) from public.shipments;').trim(),'0');
  assert.equal(sql('select count(*) from private.retired_shipment_requests;').trim(),'1');
  console.log('PASS deletion first: same-key create waits then rejects; no resurrection');
  // A rollback must not consume a key that still belongs to a live shipment.
  const key2='20000000-0000-4000-8000-000000000011',create2=create.replace(key,key2);sql(create2);
  const g=connection('shipment_rollback_first'), h=connection('shipment_retry_after_rollback');
  await g.query(`begin; delete from public.shipments where create_request_id='${key2}';`);
  const retry2=h.query(`set statement_timeout='5s'; ${create2}`);
  await waitForLock('shipment_retry_after_rollback');await g.query('rollback;');
  assert.equal(JSON.parse(await retry2).replayed,true);
  console.log('PASS rollback: waiting retry returns the original live shipment');
  // A deletes/recreates the product UUID: AFTER INSERT still rejects a retired path.
  const i=connection('product_delete_first'), j=connection('product_reinsert_second');
  await i.query(`begin; delete from public.products where id='${id}';`);
  const reinsert=j.query(`set statement_timeout='5s'; insert into public.products(id,name,reference_photo_path) values('${id}','Synthetic reinsert','${old}');`);
  await waitForLock('product_reinsert_second');await i.query('commit;');await assert.rejects(reinsert,/path is retired/);
  console.log('PASS product UUID reuse: INSERT waits for uniqueness then rejects retired path');
  console.log('NATIVE CONCURRENCY PASS '+JSON.stringify({cases:5,wallSeconds:(performance.now()-clock)/1000}));
} finally {
  for(const s of sessions)s.close();
  if(started)command('pg_ctl',['-D',data,'-m','fast','-w','stop']);
  rmSync(work,{recursive:true,force:true});
}
