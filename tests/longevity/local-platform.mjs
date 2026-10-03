// Offline adapter: real candidate SQL and unmodified Edge handler; Auth/Storage/HTTP are doubles.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
export const userId = '10000000-0000-4000-8000-000000000001';
const ident = value => { assert.match(value, /^[a-z_]+$/); return '"'+value+'"'; };
export function platform(db, functionName='shipments') {
  assert.ok(['shipments','product-photos'].includes(functionName));
  const state = { db, now: '2027-11-01T04:00:00.000Z', objects: new Map(), failRemove: 0, failQuery: null, requests: 0, queries: 0 };
  class Query {
    constructor(table) { this.table=table; this.filters=[]; this.args=[]; this.sort=[]; this.cap=37; }
    arg(value) { this.args.push(value); return '$'+this.args.length; }
    select() { return this; } // Return full rows; joins below cover the handler's only relation.
    eq(key,value) { this.filters.push(`${ident(key)} = ${this.arg(value)}`); return this; }
    gt(key,value) { this.filters.push(`${ident(key)} > ${this.arg(value)}`); return this; }
    is(key,value) { assert.equal(value,null); this.filters.push(`${ident(key)} is null`); return this; }
    or(expression) {
      const match = /^(effective_date|end_date)\.is\.null,\1\.(lte|gte)\.(\d{4}-\d{2}-\d{2})$/.exec(expression);
      assert.ok(match, expression);
      this.filters.push(`(${ident(match[1])} is null or ${ident(match[1])} ${match[2]==='lte'?'<=':'>='} ${this.arg(match[3])})`); return this;
    }
    order(key,{ascending=true,nullsFirst=false}={}) { this.sort.push(`${ident(key)} ${ascending?'asc':'desc'} nulls ${nullsFirst?'first':'last'}`); return this; }
    limit(n) { this.cap=Math.min(n,37); return this; }
    update(patch) { this.patch=patch; return this; }
    insert(row) { this.row=row; return this; }
    then(resolve,reject) { return this.execute(false).then(resolve,reject); }
    single() { return this.execute(true,true); }
    maybeSingle() { return this.execute(true); }
    async execute(one,required=false) {
      state.queries++;
      if (state.failQuery?.(this)) { state.failQuery=null; return { data:null,error:{message:'injected transport failure'} }; }
      try {
        let sql;
        if(this.row) {
          const keys=Object.keys(this.row);
          sql=`insert into public.${ident(this.table)} (${keys.map(ident)}) values (${keys.map(k=>this.arg(this.row[k]))}) returning *`;
        } else if(this.patch) {
          const assignments=Object.entries(this.patch).map(([k,v])=>`${ident(k)}=${this.arg(v)}`);
          sql=`update public.${ident(this.table)} set ${assignments.join(',')} where ${this.filters.join(' and ')||'true'} returning *`;
        } else sql=`select * from public.${ident(this.table)} where ${this.filters.join(' and ')||'true'} ${this.sort.length?'order by '+this.sort.join(','):''} limit ${this.cap}`;
        const {rows}=await state.db.query(sql,this.args);
        if(this.table==='shipments') for(const row of rows) row.intake_groups=row.intake_group_id ? (await state.db.query('select id,label,received_date from public.intake_groups where id=$1',[row.intake_group_id])).rows[0] : null;
        if(required && rows.length!==1) throw new Error('expected exactly one row');
        return {data:one ? rows[0]??null : rows,error:null};
      } catch(e) { return {data:null,error:{code:e.code,message:e.message}}; }
    }
  }
  const signatures={
    claim_product_photo_cleanup:['p_product_id','p_storage_path'],
    create_shipment_idempotent:['p_shipment','p_group_label','p_received_date','p_request_id','p_request_fingerprint'],
    update_shipment_with_group:['p_id','p_patch','p_requested_group_id','p_group_label','p_received_date'],
    delete_shipment_with_cleanup_job:['p_id'], record_shipment_cleanup_result:['p_id','p_error'],
  };
  const admin={
    auth:{getUser:async()=>({data:{user:{id:userId}},error:null})},
    from:table=>new Query(table),
    async rpc(name,args) {
      assert.ok(signatures[name],name);
      const values=signatures[name].map(k=>typeof args[k]==='object' && args[k]!==null ? JSON.stringify(args[k]) : args[k]);
      try { return {data:(await state.db.query(`select public.${ident(name)}(${values.map((_,i)=>'$'+(i+1))}) as result`,values)).rows[0].result,error:null}; }
      catch(e) { return {data:null,error:{code:e.code,message:e.message}}; }
    },
    storage:{from(bucket) {
      assert.equal(bucket,'factory-photos');
      return {
        async info(path) { return state.objects.has(path) ? {data:{name:path},error:null} : {data:null,error:{code:'NoSuchKey',statusCode:'404'}}; },
        async remove(paths) {
          if(state.beforeRemove)await state.beforeRemove(paths);
          if(state.failRemove>0) { state.failRemove--; return {data:null,error:{message:'injected Storage unavailable'}}; }
          paths.forEach(p=>state.objects.delete(p)); return {data:paths.map(name=>({name})),error:null};
        },
      };
    }},
  };
  const source=readFileSync(new URL(`../../supabase/functions/${functionName}/index.ts`,import.meta.url),'utf8').replace(/^import[^\n]+\n/gm,'');
  class Clock extends Date { constructor(...args) { super(...(args.length?args:[state.now])); } static now() { return new Date(state.now).getTime(); } }
  let handler;
  runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),{
    createClient:()=>admin,corsHeaders:{},Deno:{env:{get:k=>k==='SUPABASE_SECRET_KEYS'?'{}':'offline-only'},serve:fn=>handler=fn},
    Date:Clock,Request,Response,TextEncoder,crypto:webcrypto,console:{error(){}},
  });
  async function send(method,body,key) {
    state.requests++;
    const response=await handler(new Request('https://offline.invalid/shipments',{
      method,headers:{Authorization:'Bearer synthetic',...(key?{'Idempotency-Key':key}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
    }));
    return {status:response.status,body:await response.json()};
  }
  return {state,send,admin};
}
