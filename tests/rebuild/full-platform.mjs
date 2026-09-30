// Only a newly created local Docker platform; no remote URL or credentials accepted.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { manifest, verifyManifest } from './replay.mjs';
import { rehearse, upgrade } from '../upgrade/rehearsal.mjs';
import { exerciseWorkflow } from '../upgrade/workflow.mjs';
const upgradeMode=process.argv.includes('--upgrade');
const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const work = mkdtempSync(join(tmpdir(), 'red-slip-rebuild-'));
const cli = process.env.REBUILD_CLI;
assert.ok(cli, 'REBUILD_CLI must name the pinned local executable');
const clean = s => s.replace(/eyJ[A-Za-z0-9_.-]+/g, '[REDACTED]').replace(/(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[REDACTED]');
function run(command, args, input) {
  const r = spawnSync(command, args, { input, encoding: 'utf8', timeout: 900000, maxBuffer: 16*1024*1024 });
  if (r.status !== 0) throw new Error(clean(`${command.split('/').at(-1)} failed (${r.status}): ${r.stderr || r.error?.message || 'no diagnostic'}`));
  return r.stdout;
}
const supa = (...args) => run(cli, [...args, '--workdir', work]);
let container, edge;
const sql = text => run('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], text);
try {
  verifyManifest();
  assert.equal(supa('--version').trim(), '2.118.0');
  supa('init');
  // Fresh random workdir ID, no link command, no seed or candidate migrations at startup.
  const config = readFileSync(join(work, 'supabase/config.toml'), 'utf8');
  const id = config.match(/^project_id = "([a-zA-Z0-9_-]+)"/m)?.[1];
  assert.ok(id?.startsWith('red-slip-rebuild-'));
  container = `supabase_db_${id}`;
  assert.equal(run('docker', ['ps', '-aq', '--filter', `name=^/${container}$`]).trim(), '');
  console.log('Starting disposable full Supabase platform (CLI 2.118.0)');
  supa('start');
  assert.equal(sql("select count(*) from pg_tables where schemaname='public';").trim(), '0');
  console.log('PASS empty public schema; official Auth/Storage platform initialized');
  const entries=upgradeMode ? manifest.migrations.slice(0,1) : manifest.migrations;
  for (const entry of entries) {
    sql(read('database/rebuild/'+entry.file));
    console.log('REPLAY PASS '+entry.file);
  }
  if(upgradeMode) await rehearse(async text=>sql(text),message=>console.log('UPGRADE PASS '+message));
  sql(read('tests/rebuild/schema-regression.sql'));
  console.log('PASS catalog/RLS/grants/RPC/index regression');
  sql("update storage.buckets set id='factory-photos-test',name='factory-photos-test' where id='factory-photos';");
  sql(read('tests/cloud/test_project_guard.sql'));
  for (const id of ['T008','T009','T010','T011','T012','T018','T019_legacy_writes','T021','T026','T027','T028','T029','T030','T031']) {
    sql(read(`tests/cloud/${id}.sql`)); console.log('PASS native PostgreSQL '+id);
  }
  sql("drop schema test_guard cascade; update storage.buckets set id='factory-photos',name='factory-photos' where id='factory-photos-test'; notify pgrst, 'reload schema';");
  const status = JSON.parse(supa('status', '-o', 'json'));
  const base = new URL(status.API_URL);
  assert.ok(['127.0.0.1','localhost'].includes(base.hostname));
  assert.equal(base.protocol, 'http:');
  const api = async (path, { token=status.SERVICE_ROLE_KEY, method='GET', body, bytes, headers={}, ok=true }={}) => {
    const response = await fetch(new URL(path, base), { method, headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': bytes ? 'image/png' : 'application/json', ...headers }, body: bytes || (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(20000) });
    if (ok && !response.ok) throw new Error(`${method} ${path.split('?')[0]} HTTP ${response.status}`);
    return response;
  };
  if(upgradeMode){
    cpSync(new URL('../../supabase/functions/',import.meta.url),join(work,'supabase/functions'),{recursive:true});
    const map=join(work,'supabase/functions/import_map.json');
    writeFileSync(map,JSON.stringify({imports:{'npm:@supabase/supabase-js@2':'npm:@supabase/supabase-js@2.117.2','npm:@supabase/supabase-js@2/cors':'npm:@supabase/supabase-js@2.117.2/cors'}}));
    edge=spawn(cli,['functions','serve','--import-map',map,'--workdir',work],{stdio:'ignore',detached:true});
    edge.on('error',()=>{});
  }
  const email = `rebuild-${randomUUID()}@example.invalid`, password = randomUUID()+randomUUID();
  const account = await (await api('/auth/v1/admin/users', {method:'POST', body:{email,password,email_confirm:true}})).json();
  assert.match(account.id, /^[0-9a-f-]{36}$/);
  sql(`insert into public.profiles(user_id,email,role,active) values ('${account.id}','${email}','admin',true);`);
  const login = await (await api('/auth/v1/token?grant_type=password', {method:'POST', token:status.ANON_KEY, body:{email,password}})).json();
  assert.ok(login.access_token);
  const token = login.access_token;
  const profile = await (await api('/rest/v1/profiles?select=user_id', {token})).json();
  assert.equal(profile.length,1); assert.equal(profile[0].user_id,account.id);
  const denied = await api('/rest/v1/profiles?select=user_id', {token:status.ANON_KEY,ok:false});
  assert.ok([401,403].includes(denied.status));
  console.log('PASS real Auth login and PostgREST authenticated/anonymous RLS boundary');
  const request = {p_request_id:randomUUID(),p_name:'rebuild product',p_material:'steel',p_standard_process:'cut',p_process_notes:null,p_vendor_name:'rebuild vendor',p_vendor_id:null,p_unit_price:10,p_minimum_charge:20,p_unit:'kg',p_vendor_process:null,p_price_note:null,p_effective_date:'2026-09-30'};
  const product = await (await api('/rest/v1/rpc/create_product_with_initial_price_idempotent',{token,method:'POST',body:request})).json();
  const retry = await (await api('/rest/v1/rpc/create_product_with_initial_price_idempotent',{token,method:'POST',body:request})).json();
  assert.equal(product.replayed,false); assert.equal(retry.replayed,true);
  assert.equal(product.product.id,retry.product.id);
  assert.match(product.product.id,/^[0-9a-f-]{36}$/);
  if(upgradeMode) await exerciseWorkflow({api,sql,token,productId:product.product.id});
  sql(`delete from public.vendor_prices where product_id='${product.product.id}'; delete from public.products where id='${product.product.id}';`);
  console.log('PASS real PostgREST RPC creation and idempotent retry');
  const object = `products/${randomUUID()}.png`;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZl8AAAAASUVORK5CYII=', 'base64');
  await api('/storage/v1/object/factory-photos/'+object, {token,method:'POST',bytes});
  const download = await api('/storage/v1/object/authenticated/factory-photos/'+object,{token});
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
  const publicRead = await api('/storage/v1/object/public/factory-photos/'+object,{token:status.ANON_KEY,ok:false});
  assert.equal(publicRead.ok,false);
  await api('/storage/v1/object/factory-photos',{token,method:'DELETE',body:{prefixes:[object]}});
  assert.equal(sql('select count(*) from storage.objects;').trim(),'0');
  const absent = await api('/storage/v1/object/authenticated/factory-photos/'+object,{token,ok:false});
  const absence = await absent.json();
  assert.equal(absent.ok,false);
  assert.ok(absent.status===404 || (absent.status===400 && (String(absence.statusCode)==='404' || absence.error==='NoSuchKey')));
  console.log('PASS real private Storage upload/download/anonymous denial/delete and absence');
  await api('/auth/v1/logout?scope=global',{token,method:'POST'});
  await api('/auth/v1/admin/users/'+account.id,{method:'DELETE'});
  const tables = sql("select quote_ident(schemaname)||'.'||quote_ident(tablename) from pg_tables where schemaname in ('public','private') order by 1;").trim().split('\n');
  for (const table of [...tables,'auth.users','auth.sessions','auth.refresh_tokens','storage.objects']) assert.equal(sql(`select count(*) from ${table};`).trim(),'0',`cleanup ${table}`);
  console.log('PASS final cleanup: business rows, accounts, sessions, refresh tokens, objects all zero');
  console.log(upgradeMode ? 'FULL UPGRADE PLATFORM PASS (synthetic legacy boundary only; local Edge, no remote deployment)' : 'FULL PLATFORM PASS (no Edge Functions deployment or production compatibility claim)');
} catch (error) { console.error(clean(error.message)); process.exitCode=1; }
finally {
  if(edge?.pid) {try {process.kill(-edge.pid,'SIGTERM');} catch {}}
  try { supa('stop','--no-backup'); console.log('Disposable containers/volumes removed'); }
  catch (error) { console.error(clean(error.message)); process.exitCode=1; }
  rmSync(work,{recursive:true,force:true});
}
