// Test-only data-loss rehearsal. Called exclusively after a random, unlinked local
// platform was created empty. Retains schema and Auth; never accepts a remote URL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { digest,verifyArchive } from './integrity.mjs';
function png(color) {
 const chunk=(name,bytes)=>{const type=Buffer.from(name),data=Buffer.concat([type,bytes]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(bytes.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,data,tail]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,...color]))),chunk('IEND',Buffer.alloc(0))]);
}
export async function runRecovery({api,sql,token,container,accountId}) {
 const started=Date.now();
 assert.match(container,/^supabase_db_red-slip-rebuild-[a-zA-Z0-9_-]+$/);
 assert.match(accountId,/^[0-9a-f-]{36}$/);
 const native=(command,args,input)=>{
  const r=spawnSync('docker',['exec','-i',container,command,...args],{input,timeout:120000,maxBuffer:16*1024*1024});
  // Never print dump contents, COPY row diagnostics, Auth values or tokens.
  assert.equal(r.status,0,`${command} failed: ${r.stderr?.toString().split('\n').filter(l=>/^(pg_dump|pg_restore): (error|warning):/.test(l)).join('\n')||'see failing native operation'}`);
  return r.stdout;
 };
 for(const tool of ['pg_dump','pg_restore']) console.log('RECOVERY TOOL '+native(tool,['--version']).toString().trim());
 const tables=sql("select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','private') order by 1;").trim().split('\n');
 assert.equal(tables.length,13,'known business table inventory');
 const capture=()=>Object.fromEntries(tables.map(table=>[table,sql(`select coalesce(jsonb_agg(j order by j::text),'[]'::jsonb) from (select to_jsonb(t) j from ${table} t) s;`).trim()]));
 const fingerprint=state=>digest(JSON.stringify(state));
 const initial=capture();
 for(const table of tables) assert.equal(JSON.parse(initial[table]).length,table==='public.profiles'?1:0,'disposable precondition: no previous business data');
 assert.equal(sql('select count(*) from storage.objects;').trim(),'0');
 const security=()=>sql("select jsonb_agg(j order by j::text) from (select to_jsonb(p) j from pg_policies p where schemaname in ('public','private','storage') union all select jsonb_build_object('schema',n.nspname,'table',c.relname,'rls',c.relrowsecurity,'acl',c.relacl::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','storage') and c.relkind='r') s;").trim();
 const beforeSecurity=security();
 let fixture=readFileSync(new URL('../upgrade/fixtures.sql',import.meta.url),'utf8');
 fixture=fixture.slice(fixture.indexOf('insert into public.products'),fixture.indexOf('create schema upgrade_proof')).replaceAll('a1100000-0000-4000-8000-000000000001',accountId);
 sql(fixture);
 const paths=()=>JSON.parse(sql("select coalesce(jsonb_agg(path order by path),'[]') from (select reference_photo_path path from public.products where reference_photo_path is not null union all select storage_path from public.shipment_photos) p;").trim());
 const expectedPaths=paths();assert.equal(expectedPaths.length,2);
 const original=new Map(expectedPaths.map((p,i)=>[p,png(i?[0,0,255]:[255,0,0])]));
 const storagePath=p=>'/storage/v1/object/factory-photos/'+p;
 const download=async p=>Buffer.from(await (await api('/storage/v1/object/authenticated/factory-photos/'+p,{token})).arrayBuffer());
 for(const [p,bytes] of original) await api(storagePath(p),{token,method:'POST',bytes});
 const before=capture();
 const dump=native('pg_dump',['-U','postgres','-d','postgres','--format=custom','--data-only','--schema=public','--schema=private','--no-owner','--no-privileges']);
 const photos=new Map();for(const p of expectedPaths)photos.set(p,await download(p));
 const manifest={dump:digest(dump),photos:Object.fromEntries([...original].map(([p,b])=>[p,digest(b)]))};
 verifyArchive(manifest,dump,photos);
 assert.throws(()=>verifyArchive(manifest,dump.subarray(0,-1),photos),/database archive checksum/);
 assert.throws(()=>verifyArchive(manifest,dump,new Map([...photos].slice(1))),/photo inventory/);
 const damaged=new Map(photos);damaged.set(expectedPaths[0],Buffer.from('corrupted photo'));
 assert.throws(()=>verifyArchive(manifest,dump,damaged),/photo checksum/);
 console.log('RECOVERY PASS archive preflight rejects truncated dump, missing photo and corrupted photo');
 const wipe=()=>sql(`begin; delete from private.shipment_deletion_jobs; delete from public.shipment_photos; delete from public.shipments; delete from public.vendor_prices; delete from public.vendor_sites; delete from public.intake_groups; delete from public.products; delete from public.vendors; delete from public.dispatch_locations; delete from public.allowed_emails; delete from public.profiles; delete from private.retired_shipment_requests; delete from private.retired_product_photo_paths; commit;`);
 const restore=()=>{verifyArchive(manifest,dump,photos);native('pg_restore',['-U','postgres','-d','postgres','--data-only','--single-transaction','--exit-on-error','--no-owner','--no-privileges'],dump);};
 const audit=async()=>{
  assert.equal(fingerprint(capture()),fingerprint(before),'business row integrity');
  assert.deepEqual(paths(),expectedPaths,'photo links');
  const inventory=JSON.parse(sql("select coalesce(jsonb_agg(name order by name),'[]') from storage.objects where bucket_id='factory-photos';").trim());
  assert.deepEqual(inventory,expectedPaths,'restored photo inventory');
  for(const p of expectedPaths) assert.equal(digest(await download(p)),manifest.photos[p],'restored photo bytes');
  assert.equal(security(),beforeSecurity,'RLS/grants unchanged');
 };
 await api('/storage/v1/object/factory-photos',{token,method:'DELETE',body:{prefixes:expectedPaths}});
 wipe();
 for(const rows of Object.values(capture()))assert.equal(JSON.parse(rows).length,0,'data loss simulated');
 assert.equal(sql('select count(*) from storage.objects;').trim(),'0');
 restore();
 await assert.rejects(audit,/restored photo inventory/);
 console.log('RECOVERY PASS database-only restoration correctly fails missing-photo audit');
 for(const [p,bytes] of photos)await api(storagePath(p),{token,method:'POST',bytes});
 await audit();
 // Genuine altered Storage bytes and altered accounting amount must be detected.
 await api(storagePath(expectedPaths[0]),{token,method:'POST',bytes:png([0,255,0]),headers:{'x-upsert':'true'}});
 await assert.rejects(audit,/restored photo bytes/);
 await api(storagePath(expectedPaths[0]),{token,method:'POST',bytes:photos.get(expectedPaths[0]),headers:{'x-upsert':'true'}});
 sql("update public.shipments set calculated_amount_snapshot=1 where calculated_amount_snapshot is not null;");
 await assert.rejects(audit,/business row integrity/);
 wipe();restore();await audit();
 const ledger=await(await api('/rest/v1/shipments?select=id,calculated_amount_snapshot,unit_price_snapshot,product_id,intake_group_id',{token})).json();
 assert.equal(ledger.length,2);assert.equal(ledger.filter(r=>Number(r.calculated_amount_snapshot)===864.15&&Number(r.unit_price_snapshot)===70).length,1);
 const profile=await(await api('/rest/v1/profiles?select=user_id',{token})).json();assert.equal(profile[0].user_id,accountId);
 console.log('RECOVERY PASS records, relationships, historical 864.15 amount / 70 price, photo paths/bytes and retained Auth access restored');
 console.log('RECOVERY PASS altered live photo and accounting amount detected, then repaired from the verified archive');
 await api('/storage/v1/object/factory-photos',{token,method:'DELETE',body:{prefixes:expectedPaths}});
 // Restore the exact pre-fixture state, keeping only the harness account profile.
 sql("delete from private.shipment_deletion_jobs; delete from public.shipment_photos; delete from public.shipments; delete from public.vendor_prices; delete from public.vendor_sites; delete from public.intake_groups; delete from public.products; delete from public.vendors; delete from public.dispatch_locations;");
 assert.equal(fingerprint(capture()),fingerprint(initial),'recovery fixture cleanup');
 assert.equal(sql('select count(*) from storage.objects;').trim(),'0');
 for(const p of expectedPaths){
  let missing=false;
  for(let attempt=0;attempt<5;attempt++){
   const response=await api('/storage/v1/object/authenticated/factory-photos/'+p,{token,ok:false});
   if(!response.ok){const body=await response.json();missing=response.status===404||(response.status===400&&(String(body.statusCode)==='404'||body.error==='NoSuchKey'));if(!missing)throw new Error('unexpected Storage cleanup response');break;}
   await new Promise(resolve=>setTimeout(resolve,200*(attempt+1)));
  }
  assert.ok(missing,'deleted photo bytes absent');
 }
 console.log(`RECOVERY PASS cleanup; 11 business tables compared, 2 shipments, 2 distinct PNGs; duration_ms=${Date.now()-started}; schema/Auth retained, no production backup configured`);
 dump.fill(0);for(const bytes of photos.values())bytes.fill(0);
}
