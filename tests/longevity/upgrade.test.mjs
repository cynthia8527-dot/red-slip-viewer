import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { read,upgrade,verifyUpgrade,applyFollowups } from '../upgrade/rehearsal.mjs';
import { capture,uuid } from './scenario.mjs';
import { platform,userId } from './local-platform.mjs';
test('six months of accumulated rows survive failed/successful migration and six further months',async()=>{
  verifyUpgrade();
  const db=new PGlite({extensions:{pgcrypto}});
  try {
    await db.exec(read('tests/rebuild/platform-contract.sql'));
    await db.exec(read(upgrade.legacy_source.path));
    await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'upgrade@example.invalid']);
    await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'upgrade@example.invalid']);
    await db.query("insert into public.products(id,name) values ($1,'Synthetic')",[uuid(1)]);
    await db.query("insert into public.vendor_prices(vendor_name,product_id,unit_price,effective_date) values ('Synthetic',$1,70,'2027-11-01')",[uuid(1)]);
    for(let m=0;m<6;m++) {
      const date=new Date(Date.UTC(2027,10+m,15)).toISOString();
      const group=(await db.query("insert into public.intake_groups(vendor_name,label,received_date,is_demo) values ('Synthetic',$1,$2,false) returning id",[`M${m}`,date.slice(0,10)])).rows[0].id;
      for(let i=0;i<24;i++) {
        const id=uuid(100+m*24+i);
        await db.query("insert into public.shipments(id,vendor_name,item_name,product_id,intake_group_id,location,status,weight_kg,is_demo,shipped_at,unit_price_snapshot,unit_snapshot,calculated_amount_snapshot,voided_at) values ($1,'Synthetic','Synthetic',$2,$3,'蘆洲','已出貨',12.345,false,$4,70,'kg',864.15,$5)",[id,uuid(1),group,date,i%4===0?date:null]);
        if(i%4===0) await db.query('insert into public.shipment_photos(shipment_id,storage_path) values ($1,$2)',[id,`shipments/${id}/synthetic.png`]);
      }
    }
    const before=await capture(db);
    // A real late DDL conflict must roll back additive columns and all preceding statements.
    await db.exec("create function public.record_shipment_cleanup_result(uuid,text) returns text language sql as $$ select 'injected conflict' $$");
    await assert.rejects(db.exec(read(upgrade.candidate.path)),/cannot change return type/);await db.exec('rollback');
    assert.deepEqual(await capture(db),before,'failed migration changed accumulated rows');
    assert.equal((await db.query("select count(*)::int as n from information_schema.columns where table_name='shipments' and column_name='create_request_id'")).rows[0].n,0);
    await db.exec('drop function public.record_shipment_cleanup_result(uuid,text)');
    await db.exec(read(upgrade.candidate.path));
    await applyFollowups(sql=>db.exec(sql));
    const after=await capture(db);
    for(const [table,rows] of Object.entries(before)) {
      assert.equal(after[table].length,rows.length,table);
      assert.deepEqual(after[table].map(row=>Object.fromEntries(Object.keys(rows[0]||{}).map(k=>[k,row[k]]))),rows,`upgrade rewrote ${table}`);
    }
    const {send,state}=platform(db);
    for(let m=6;m<12;m++) {
      state.now=new Date(Date.UTC(2027,10+m,15)).toISOString();
      for(let i=0;i<24;i++) {
        const key=uuid(1000+m*24+i), body={vendor_name:'Synthetic',item_name:'Synthetic',product_id:uuid(1),weight_kg:12.345,status:'已出貨'};
        const first=await send('POST',body,key),retry=await send('POST',body,key);
        assert.equal(first.status,201);assert.equal(retry.status,201);
        assert.equal(retry.body.replayed,true);assert.equal(first.body.shipment.id,retry.body.shipment.id);
      }
    }
    assert.equal((await db.query('select count(*)::int as n from public.shipments')).rows[0].n,288);
    assert.equal((await db.query('select count(*)::int as n from public.shipments where create_request_id is not null and (calculated_amount_snapshot <> 864 or unit_price_snapshot <> 70)')).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from public.shipments where create_request_id is null and calculated_amount_snapshot = 864.15')).rows[0].n,144);
    assert.equal((await db.query('select count(*)::int as n from public.shipment_photos')).rows[0].n,36);
    for(const row of before['public.shipments']) {
      const actual=(await db.query('select * from public.shipments where id=$1',[row.id])).rows[0];
      assert.deepEqual(Object.fromEntries(Object.keys(row).map(k=>[k,actual[k]])),row,'later operations changed legacy row');
    }
  } finally {await db.close();}
});
