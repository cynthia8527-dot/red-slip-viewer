import test from 'node:test';
import assert from 'node:assert/strict';
import {readAllRows} from '../../data/pagination.js';
const records=Array.from({length:1201},(_,i)=>({id:String(i+1).padStart(8,'0')}));
function factory({cap=500,fail=false,repeat=false,remove=false}={}){
 let calls=0,rows=[...records];
 return ()=>{
  let cursor='';calls++;
  if(remove&&calls===2)rows=rows.slice(1);
  return {order(){return this},limit(){return this},gt(k,v){assert.equal(k,'id');cursor=v;return this},then(resolve){resolve(fail&&calls===2?{error:new Error('later page failed')}:{data:(repeat?rows:rows.filter(x=>x.id>cursor)).slice(0,cap),error:null})}};
 };
}
test('Catalog pagination reads beyond cap, including servers with a lower cap',async()=>{
 for(const cap of [500,173]){const {data,error}=await readAllRows(factory({cap}));assert.equal(error,null);assert.deepEqual(data,records);}
});
test('Catalog pagination fails closed for later-page error or nonadvancing cursor',async()=>{
 for(const opts of [{fail:true},{repeat:true}]){const {data,error}=await readAllRows(factory(opts));assert.equal(data,null);assert.ok(error);}
});
test('Deleting an earlier row between pages does not skip the next record',async()=>{
 const {data,error}=await readAllRows(factory({remove:true}));assert.equal(error,null);assert.deepEqual(data,records);
});
