import test from 'node:test';
import assert from 'node:assert/strict';
import {rebuild} from './rebuild/replay.mjs';
import {vendorImportRows} from '../data/vendor-import.js';
import * as XLSX from 'xlsx';
const admin='40000000-0000-4000-8000-000000000001';
const rows=vendorImportRows([[],['A','總廠','Company','月結','123', '聯絡人','00123',null,'原址',null,'備註',null,'狀態'],['A-P2','二廠','Company',null,'123',null,null,null,'分廠址']]);
test('workbook mapping preserves text, mail, inactive status and limits',()=>{
 const parsed=vendorImportRows([[],[' A ',' Name ','Company',null,'0012',null,' 01\n23 ',null,'Address',null,'很久沒交易']], [[],[' A ','Company',' Mail ']]);
 assert.equal(parsed[0].tax_id,'0012');assert.equal(parsed[0].phone,'01 23');assert.equal(parsed[0].billing_address,'Mail');assert.equal(parsed[0].is_active,false);
 assert.throws(()=>vendorImportRows([[]]),/沒有可匯入/);
 assert.throws(()=>vendorImportRows([[],...Array(5001).fill(['A','B'])]),/上限/);
});
test('actual XLSX and legacy XLS binary round trips preserve formatted identifiers and mapping',()=>{
 for(const bookType of ['xlsx','xls']){
  const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet([['代碼','簡稱'],['001','測試公司','測試抬頭',null,'00001234',null,1234,null,'台北 地址']]);
  sheet.G2.z='00000000';
  XLSX.utils.book_append_sheet(book,sheet,'客戶-通訊錄');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['代碼','抬頭','地址'],['001','測試抬頭','帳單 地址']]),'工作表2');
  const binary=XLSX.write(book,{type:'buffer',bookType});assert.ok(binary.length>1000);assert.notEqual(binary[0],123,'not JSON fixture');
  const decoded=XLSX.read(binary,{type:'array'}),read=s=>XLSX.utils.sheet_to_json(s,{header:1,defval:null,raw:false});
  const rows=vendorImportRows(read(decoded.Sheets['客戶-通訊錄']),read(decoded.Sheets['工作表2']));
  assert.equal(rows[0].code,'001');assert.equal(rows[0].tax_id,'00001234');assert.equal(rows[0].phone,'00001234');assert.equal(rows[0].billing_address,'帳單 地址');
  if(bookType==='xlsx')assert.throws(()=>XLSX.read(binary.subarray(0,64),{type:'array'}));
 }
});
test('atomic import: failure rolls back parent and site; retries skip duplicates; no existing-row rewrite; RLS denies staff',async()=>{
 const db=await rebuild();
 const call=r=>db.query('select public.import_vendor_workbook($1::jsonb) result',[JSON.stringify(r)]).then(x=>x.rows[0].result);
 const snapshot=async()=> (await db.query("select jsonb_build_object('v',(select jsonb_agg(to_jsonb(v) order by id) from public.vendors v),'s',(select jsonb_agg(to_jsonb(s) order by id) from public.vendor_sites s)) data")).rows[0].data;
 try{
  await db.query("insert into auth.users(id,email) values ($1,'admin@example.invalid')",[admin]);
  await db.query("insert into public.profiles(user_id,email,role,active) values ($1,'admin@example.invalid','admin',true)",[admin]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
  await db.exec("create function public.import_fail_test() returns trigger language plpgsql as $$ begin raise exception 'injected site failure'; end $$; create trigger import_fail before insert on public.vendor_sites for each row execute function public.import_fail_test();set role authenticated");
  await assert.rejects(call(rows),/injected site failure/);
  assert.deepEqual(await snapshot(),{v:null,s:null});
  await db.exec('reset role; drop trigger import_fail on public.vendor_sites;drop function public.import_fail_test();set role authenticated');
  assert.deepEqual(await call(rows),{added:1,site_added:1,skipped:0,total:2});
  const before=await snapshot();
  // Treat successful response as lost. Re-submit after reload / another client.
  assert.deepEqual(await call(rows),{added:0,site_added:0,skipped:2,total:2});
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await call([rows[0],rows[0],rows[1],rows[1]]),{added:0,site_added:0,skipped:4,total:4});
  await assert.rejects(call([{...rows[0],code:'NEW'},{...rows[1],id:admin}]),/Unexpected workbook field/);
  assert.deepEqual(await snapshot(),before);
  for(const payload of [null,{},[],[{code:'x',short_name:'y',is_active:'true'}]])await assert.rejects(call(payload),{code:'22023'});
  for(const payload of [Array(5001).fill(rows[0]),[{...rows[0],note:'x'.repeat(10001)}],[{...rows[0],is_active:null}],[{...rows[0],tax_id:{role:'admin'}}],[{...rows[0],code:'   '}],Array(300).fill({...rows[0],note:'x'.repeat(9000)})])await assert.rejects(call(payload),{code:'22023'});
  assert.deepEqual(await snapshot(),before,'malformed/oversize requests cannot change earlier rows');
  await db.exec('reset role');
  await db.query("update public.profiles set role='staff' where user_id=$1",[admin]);await db.exec('set role authenticated');
  await assert.rejects(call(rows),{code:'42501'});
  await db.exec('reset role');await db.query("update public.profiles set role='admin',active=false where user_id=$1",[admin]);await db.exec('set role authenticated');
  await assert.rejects(call(rows),{code:'42501'});await db.exec('reset role');
  for(const role of ['anon','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.import_vendor_workbook(jsonb)','execute') ok",[role])).rows[0].ok,false);
  assert.equal((await db.query("select prosecdef from pg_proc where oid='public.import_vendor_workbook(jsonb)'::regprocedure")).rows[0].prosecdef,false);
 }finally{await db.close()}
});
