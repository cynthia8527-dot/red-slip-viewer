import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const rows=Array.from({length:1201},(_,i)=>({id:`${i+1}`.padStart(8,'0')+'-0000-4000-8000-000000000000',created_at:'2026-01-01',is_demo:false}));
function handler({failPage=false}={}){
 let callback;
 const source=readFileSync(new URL('../../supabase/functions/shipments/index.ts',import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
 const admin={auth:{getUser:async()=>({data:{user:{id:'test-user'}}})},from(table){
  if(table==='profiles')return {select(){return this},eq(){return this},maybeSingle:async()=>({data:{role:'admin',active:true}})};
  assert.equal(table,'shipments');
  let cursor='',limit=1000;
  return {select(){return this},eq(){return this},order(){return this},gt(_key,value){cursor=value;return this},limit(n){limit=Math.min(n,1000);return this},then(resolve){resolve(failPage&&cursor?{data:null,error:{message:'page failed'}}:{data:rows.filter(x=>x.id>cursor).slice(0,limit),error:null})}};
 }};
 runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),{createClient:()=>admin,corsHeaders:{},Deno:{env:{get:()=>undefined},serve:fn=>callback=fn},Request,Response,crypto,TextEncoder,console:{error(){}}});
 return callback;
}
test('Shipment list returns every record beyond server row cap',async()=>{
 const r=await handler()(new Request('http://localhost/functions/v1/shipments',{headers:{Authorization:'Bearer synthetic'}}));
 assert.equal(r.status,200);const data=await r.json();assert.equal(data.shipments.length,1201);assert.equal(new Set(data.shipments.map(x=>x.id)).size,1201);
});
test('Shipment list fails rather than presenting a partial later-page result',async()=>{
 const r=await handler({failPage:true})(new Request('http://localhost/functions/v1/shipments',{headers:{Authorization:'Bearer synthetic'}}));assert.equal(r.status,500);
});
