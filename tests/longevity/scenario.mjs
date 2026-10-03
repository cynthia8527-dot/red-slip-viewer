import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { rebuild } from '../rebuild/replay.mjs';
import { platform, userId } from './local-platform.mjs';
import { selectCurrentPrices } from '../../data/pricing.js';
import { readAllRows } from '../../data/pagination.js';
export const uuid = n => `20000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export class InvalidTrace extends Error {}
const product=uuid(1), vendor=uuid(2);
export function generate(seed) {
  let r=seed>>>0;
  const random=n=>{ r^=r<<13; r^=r>>>17; r^=r<<5; return (r>>>0)%n; };
  const ops=[];
  const add=(type,extra={})=>ops.push({type,...extra});
  let count=10, carry;
  for(let month=0;month<12;month++) {
    const date=new Date(Date.UTC(2027,10+month,1)).toISOString().slice(0,10);
    // Taipei midnight is still the previous UTC day: exercise the real date selector.
    const now=new Date(Date.parse(date+'T00:00:00+08:00')).toISOString();
    add('clock',{now});
    if(carry) {
      add('replay',{key:carry});
      if(month%3===0) { add('patch',{key:carry,patch:{status:'完成待出貨'}});add('patch',{key:carry,patch:{status:'已出貨'}}); }
    }
    for(let i=0;i<16;i++) {
      const mode=i===15?1:random(4);
      const key=uuid(count++), grams=[3_000,12_345,100,10_001,2_550][random(5)];
      add('create',{key,grams,date,group:`M${month}-${i%3}`});
      if(i===0) add('conflict',{key});
      add('replay',{key});
      add('patch',{key,patch:{status:'處理中'}});
      if(mode===0) {
        add('badGroup',{key,date});
        add('patch',{key,patch:{intake_group_label:`moved-${month}`,received_date:date,status:'完成待出貨'}});
      } else add('patch',{key,patch:{status:'完成待出貨'}});
      add('patch',{key,patch:{status:'已出貨'}});
      add('patch',{key,patch:{status:'已出貨',note:'duplicate shipment click'}});
      add('attach',{key});
      if(mode===0) {
        add('void',{key}); add('blockedEdit',{key});
        add('restore',{key}); add('void',{key}); add('deleteFail',{key});
        if(month===5 && !ops.some(o=>o.type==='restartPending'))add('restartPending');
        add('deleteRetry',{key}); add('deleteRetry',{key});
      } else {
        if(mode===1) { add('void',{key}); add('restore',{key}); }
        carry=key;
      }
    }
    add('priceEdit',{date:date.slice(0,8)+'15',cents:100+random(10000)});
    add('audit');
    add('listFailure');
    // Persist SQL data through an actual PGlite close/open, with the same stub Storage map.
    if([3,7,11].includes(month)) add('restart');
  }
  // Explicit leap-day and midnight boundaries in addition to all month starts.
  for(const now of ['2028-02-28T15:59:59.999Z','2028-02-28T16:00:00.000Z','2028-02-29T15:59:59.999Z','2028-02-29T16:00:00.000Z','2028-12-31T16:00:00.000Z']) add('priceBoundary',{now});
  return ops;
}
export async function run(ops,{seed=1,onProgress=()=>{},failAt=null}={}) {
  const started=performance.now();
  let db=await rebuild();
  const app=platform(db), {state,send}=app;
  const photoApp=platform(db,'product-photos');photoApp.state.objects=state.objects;
  let photoPath=null,photoCycles=0;
  const model=new Map(), precision=[];
  let executed=0, restarts=0, audits=0, injected=0;
  const periods=[];
  const signature=e=>(e.code||e.name)+':'+e.message.split('\n')[0];
  const check=(value,label)=>assert.ok(value,label);
  try {
    await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'longevity@example.invalid']);
    await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'longevity@example.invalid']);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]);
    await db.query("insert into public.products(id,name) values ($1,'Synthetic longevity product')",[product]);
    await db.query("insert into public.vendors(id,code,short_name) values ($1,'SYNTHETIC','Synthetic longevity vendor')",[vendor]);
    let price=(await db.query("insert into public.vendor_prices(vendor_id,vendor_name,product_id,unit_price,minimum_charge,effective_date) values ($1,'Synthetic longevity vendor',$2,0.10,null,'2027-10-01') returning id",[vendor,product])).rows[0];
    periods.push({date:'2027-10-01',cents:10,minimum:null});
    const dates=['2027-12-01','2028-01-01','2028-02-29','2028-03-01','2028-04-01','2028-05-01','2028-06-01','2028-07-01','2028-08-01','2028-09-01','2028-10-01','2029-01-01'];
    for(const [i,date] of dates.entries()) {
      const cents=[7000,9999,1234,101,10][(i+seed)%5], minimum=i%3===0?2500:null;
      price=(await db.query('select * from public.replace_vendor_price($1,$2,$3,$4,$5,$6,$7)',[price.id,cents/100,minimum===null?null:minimum/100,'kg','synthetic',date,null])).rows[0];
      periods.push({date,cents,minimum});
    }
    // Insert a historical split after future changes are already scheduled.
    const initial=(await db.query("select id from public.vendor_prices where effective_date='2027-10-01'")).rows[0];
    await db.query('select public.replace_vendor_price($1,0.20,null,$2,null,$3,null)',[initial.id,'kg','2027-10-15']);
    periods.push({date:'2027-10-15',cents:20,minimum:null}); periods.sort((a,b)=>a.date.localeCompare(b.date));
    const at=now=>{
      const date=new Date(Date.parse(now)+8*3600_000).toISOString().slice(0,10);
      return periods.filter(p=>p.date<=date).at(-1);
    };
    const rows=()=>db.query('select * from public.shipments order by create_request_id').then(r=>r.rows);
    const request=async(method,body,key,status)=>{
      const response=await send(method,body,key);
      assert.equal(response.status,status,`HTTP ${method}: ${JSON.stringify(response.body)}`);
      return response.body;
    };
    const amount=m=>{
      if(!m.frozen)return null;
      const raw=BigInt(m.frozen.cents)*BigInt(m.grams);
      const minimum=BigInt(m.frozen.minimum||0)*1000n;
      const bounded=raw>minimum?raw:minimum;
      return (bounded+50000n)/100000n; // independent whole-unit oracle; generated amounts are nonnegative
    };
    const snapshot=m=>({price:m.frozen?.cents/100,amount:amount(m)});
    async function verifyRow(m) {
      const row=(await db.query('select * from public.shipments where id=$1',[m.id])).rows[0];
      if(m.deleted) { check(!row,'deleted shipment resurrected');return; }
      check(row,'shipment missing');
      assert.equal(row.status,m.status,'state diverged');
      assert.equal(Boolean(row.voided_at),m.voided,'void state diverged');
      assert.equal(row.product_id,product,'product reference diverged');
      assert.equal(row.vendor_id,vendor,'vendor reference diverged');
      if(m.frozen) {
        const expected=snapshot(m);
        const saved={price:row.unit_price_snapshot,unit:row.unit_snapshot,minimum:row.minimum_charge_snapshot,amount:row.calculated_amount_snapshot,shippedAt:row.shipped_at};
        if(m.saved)assert.deepEqual(saved,m.saved,'frozen fields rewritten');else m.saved=saved;
        assert.equal(row.unit_snapshot,'kg','frozen unit changed');
        assert.equal(row.minimum_charge_snapshot===null?null:Number(row.minimum_charge_snapshot),m.frozen.minimum===null?null:m.frozen.minimum/100,'frozen minimum changed');
        assert.equal(Number(row.unit_price_snapshot),expected.price,'price snapshot rewritten');
        assert.equal(new Date(row.shipped_at).toISOString(),m.shippedAt,'shipped timestamp rewritten');
        assert.equal(BigInt(row.calculated_amount_snapshot),expected.amount,'whole-unit snapshot diverged');
      } else assert.equal(row.calculated_amount_snapshot,null,'unshipped amount unexpectedly frozen');
      if(m.group) {
        const group=(await db.query('select label from public.intake_groups where id=$1',[row.intake_group_id])).rows[0];
        assert.equal(group?.label,m.group,'group reference diverged');
      }
    }
    async function audit() {
      audits++;
      const actual=await rows(), live=[...model.values()].filter(m=>!m.deleted);
      assert.equal(actual.length,live.length,'row count drift');
      assert.equal(new Set(actual.map(r=>r.create_request_id)).size,live.length,'duplicate request');
      for(const m of model.values()) await verifyRow(m);
      const all=(await request('GET',null,null,200)).shipments;
      assert.deepEqual(all.map(r=>r.id).sort(),live.map(m=>m.id).sort(),'Edge pagination loss/duplicate');
      const front=await readAllRows(()=>app.admin.from('shipments').select('*'));
      assert.equal(front.error,null);
      assert.deepEqual(front.data.map(r=>r.id).sort(),live.map(m=>m.id).sort(),'frontend pagination loss/duplicate');
      const photos=(await db.query('select storage_path,shipment_id from public.shipment_photos')).rows;
      for(const p of photos) { check(state.objects.has(p.storage_path),'photo DB reference without object');check(actual.some(r=>r.id===p.shipment_id),'photo orphan FK'); }
      const jobs=(await db.query('select * from private.shipment_deletion_jobs')).rows;
      for(const j of jobs) { check(j.cleanup_completed_at,'unfinished cleanup');check(j.storage_paths.every(p=>!state.objects.has(p)),'completed job retains object');assert.equal(j.attempts,2,'cleanup attempts drift'); }
      assert.equal(jobs.length,[...model.values()].filter(m=>m.deleted).length,'deletion job lost or duplicated');
      assert.equal((await db.query('select count(*)::int n from private.retired_shipment_requests')).rows[0].n,[...model.values()].filter(m=>m.deleted).length,'retired request lost or duplicated');
      const reference=(await db.query('select reference_photo_path from public.products where id=$1',[product])).rows[0].reference_photo_path;
      assert.equal(reference,photoPath,'product photo reference diverged');
      if(photoPath)check(state.objects.has(photoPath),'current product photo missing');
      assert.equal(state.objects.size,photos.length+(photoPath?1:0),'untracked Storage orphan');
    }
    async function cycleProductPhoto() {
      photoApp.state.now=state.now;
      const next=`products/${product}/seed-${seed}-${++photoCycles}.png`;
      state.objects.set(next,Buffer.from('synthetic product '+photoCycles));
      const body={id:product,storage_path:next,previous_storage_path:photoPath};
      if(photoPath && photoCycles%2===0) {
        // A's DB claim is committed; interleave B immediately before Storage remove.
        const previous=photoPath;
        photoApp.state.beforeRemove=async()=>{
          photoApp.state.beforeRemove=null;
          const b=await photoApp.send('POST',{id:product,storage_path:previous,previous_storage_path:next});
          assert.equal(b.status,409,'concurrent relink of retired path accepted');
        };
        assert.equal((await photoApp.send('POST',body)).status,201);
      } else if(photoPath) {
        photoApp.state.failRemove=1;
        assert.equal((await photoApp.send('POST',body)).status,202);
        assert.equal((await photoApp.send('POST',body)).status,200);
      } else assert.equal((await photoApp.send('POST',body)).status,201);
      photoPath=next;
    }
    for(const op of ops) {
      executed++;
      const m=op.key?model.get(op.key):null;
      if(op.key && op.type!=='create' && !m) throw new InvalidTrace('missing dependency');
      if(failAt===executed) throw new Error('injected reducer sentinel');
      switch(op.type) {
        case 'clock': state.now=op.now;break;
        case 'create': {
          if(m)throw new InvalidTrace('duplicate symbolic key');
          const body={vendor_name:'Synthetic longevity vendor',vendor_id:vendor,item_name:'Synthetic longevity product',product_id:product,weight_kg:op.grams/1000,status:'未開始',intake_group_label:op.group,received_date:op.date};
          const result=await request('POST',body,op.key,201);
          model.set(op.key,{key:op.key,id:result.shipment.id,body,grams:op.grams,status:'未開始',voided:false,deleted:false,frozen:null,group:op.group});break;
        }
        case 'replay': {
          if(m.deleted) throw new InvalidTrace('replay after delete is a separate risk scenario');
          const result=await request('POST',m.body,m.key,201);
          assert.equal(result.replayed,true,'retry did not replay');assert.equal(result.shipment.id,m.id,'duplicate shipment');break;
        }
        case 'conflict': await request('POST',{...m.body,weight_kg:999},m.key,409);break;
        case 'patch': {
          if(m.deleted||m.voided)throw new InvalidTrace('edit unavailable');
          await request('PATCH',{id:m.id,...op.patch},null,200);
          if(op.patch.status==='已出貨'&&m.status!=='已出貨') {m.frozen={...at(state.now)};m.shippedAt=state.now;m.saved=null;}
          if(op.patch.status&&op.patch.status!=='已出貨'&&m.status==='已出貨') {m.frozen=null;m.shippedAt=null;m.saved=null;}
          if(op.patch.status)m.status=op.patch.status;
          if(op.patch.intake_group_label)m.group=op.patch.intake_group_label;
          break;
        }
        case 'badGroup': {
          const before=await rows(), groups=(await db.query('select * from public.intake_groups order by id')).rows;
          await request('PATCH',{id:m.id,intake_group_label:'FAIL-ROLLBACK',received_date:op.date,location:'invalid'},null,500);
          assert.deepEqual(await rows(),before,'failed grouped update changed data');
          assert.deepEqual((await db.query('select * from public.intake_groups order by id')).rows,groups,'failed update leaked group');injected++;break;
        }
        case 'void': await request('PATCH',{id:m.id,action:'void',void_reason:'Synthetic cancellation'},null,200);m.voided=true;break;
        case 'restore': await request('PATCH',{id:m.id,action:'restore'},null,200);m.voided=false;break;
        case 'blockedEdit': if(!m.voided)throw new InvalidTrace('must be void');await request('PATCH',{id:m.id,note:'should reject'},null,409);break;
        case 'attach': {
          const path=`shipments/${m.id}/synthetic.png`;
          state.objects.set(path,Buffer.from('synthetic-photo-bytes'));
          await request('POST',{id:m.id,action:'attach_photo',storage_path:path},null,201);
          assert.equal((await request('POST',{id:m.id,action:'attach_photo',storage_path:path},null,200)).replayed,true);break;
        }
        case 'deleteFail': {
          if(!m.voided)throw new InvalidTrace('must be void');
          state.failRemove=1;
          const response=await request('DELETE',{id:m.id},null,202);assert.equal(response.cleanup_pending,true);m.deleted=true;
          const job=(await db.query('select * from private.shipment_deletion_jobs where shipment_id=$1',[m.id])).rows[0];
          assert.equal(job.cleanup_completed_at,null);assert.equal(job.attempts,1);check(job.storage_paths.every(p=>state.objects.has(p)),'failed removal lost objects');injected++;break;
        }
        case 'deleteRetry':
          if(!m.deleted)throw new InvalidTrace('requires delete');
          assert.equal((await request('DELETE',{id:m.id},null,200)).cleanup_pending,false);
          await request('POST',m.body,m.key,409); // original key remains consumed after deletion/restart
          break;
        case 'audit': await cycleProductPhoto();await audit(); onProgress({seed,step:executed,live:[...model.values()].filter(m=>!m.deleted).length,precisionFindings:precision.length});break;
        case 'listFailure': {
          state.failQuery=q=>q.table==='shipments'&&q.filters.some(f=>f.includes(' > '));
          const result=await request('GET',null,null,500);assert.equal(result.shipments,undefined,'published partial data');
          await request('GET',null,null,200);injected++;break;
        }
        case 'restart': case 'restartPending': {
          const before=await capture(db), archive=await db.dumpDataDir();await db.close();
          db=new PGlite({extensions:{pgcrypto},loadDataDir:archive});state.db=db;photoApp.state.db=db;
          await db.query("select set_config('request.jwt.claim.sub',$1,false)",[userId]);
          assert.deepEqual(await capture(db),before,'restart changed database');if(op.type==='restart')await audit();restarts++;break;
        }
        case 'priceEdit': {
          const target=(await db.query('select id from public.vendor_prices where effective_date <= $1 and (end_date is null or end_date >= $1) order by effective_date desc limit 1',[op.date])).rows[0];
          await db.query('select public.replace_vendor_price($1,$2,null,$3,null,$4,null)',[target.id,op.cents/100,'kg',op.date]);
          periods.push({date:op.date,cents:op.cents,minimum:null});periods.sort((a,b)=>a.date.localeCompare(b.date));break;
        }
        case 'priceBoundary': {
          const prices=(await db.query('select * from public.vendor_prices')).rows.map(p=>({...p,effective_date:p.effective_date?.toISOString().slice(0,10)??null,end_date:p.end_date?.toISOString().slice(0,10)??null}));
          const date=new Date(Date.parse(op.now)+8*3600_000).toISOString().slice(0,10);
          const chosen=selectCurrentPrices(prices,date);assert.equal(chosen.length,1,'price coverage gap/overlap');
          assert.equal(Number(chosen[0].unit_price),at(op.now).cents/100,'effective date model diverged');
          state.now=op.now;
          // Exercise actual Edge date selection, not only the frontend helper.
          const key=uuid(90000+executed);
          const body={vendor_name:'Synthetic longevity vendor',vendor_id:vendor,item_name:'boundary',product_id:product,weight_kg:3,status:'已出貨'};
          const result=await request('POST',body,key,201);
          model.set(key,{key,id:result.shipment.id,body,grams:3000,status:'已出貨',voided:false,deleted:false,frozen:{...at(op.now)},shippedAt:op.now});
          await verifyRow(model.get(key));break;
        }
        default: throw new InvalidTrace('unknown operation');
      }
      if(m)await verifyRow(m);
    }
    await audit();
    return {seed,months:12,operations:executed,requests:state.requests,photoRequests:photoApp.state.requests,photoCycles,queries:state.queries,created:model.size,retained:[...model.values()].filter(m=>!m.deleted).length,restarts,audits,injected,precision,elapsedSeconds:(performance.now()-started)/1000};
  } catch(error) {
    error.step=executed;error.operation=ops[executed-1];error.signature=signature(error);throw error;
  } finally {await db.close();}
}
export async function capture(db) {
  const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','private','auth') order by 1,2")).rows;
  const result={};
  for(const t of tables) result[`${t.schemaname}.${t.tablename}`]=(await db.query(`select * from "${t.schemaname}"."${t.tablename}" order by 1`)).rows;
  return result;
}
