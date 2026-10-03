// Diagnostic only: use actual Edge calculation, database numeric storage and board formatter.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rebuild } from '../rebuild/replay.mjs';
import { platform,userId } from './local-platform.mjs';
import { uuid } from './scenario.mjs';
const db=await rebuild();
try {
  await db.query('insert into auth.users(id,email) values ($1,$2)',[userId,'money@example.invalid']);
  await db.query("insert into public.profiles(user_id,email,role,active) values ($1,$2,'admin',true)",[userId,'money@example.invalid']);
  await db.query("insert into public.products(id,name) values ($1,'Synthetic')",[uuid(1)]);
  const source=readFileSync(new URL('../../board/index.html',import.meta.url),'utf8');
  const start=source.indexOf('function amountSnapshotText('),end=source.indexOf('function taipeiYearMonth(',start);
  const context={};runInNewContext(source.slice(start,end)+';globalThis.format=amountSnapshotText;',context);
  const {send}=platform(db);
  for(const [i,price,weight,exact] of [[10,'0.10',3,'0'],[11,'70.00',12.345,'864']]) {
    await db.query('delete from public.vendor_prices');
    await db.query("insert into public.vendor_prices(vendor_name,product_id,unit_price,effective_date) values ('Synthetic',$1,$2,'2027-01-01')",[uuid(1),price]);
    const result=await send('POST',{vendor_name:'Synthetic',item_name:'Synthetic',product_id:uuid(1),weight_kg:weight,status:'已出貨'},uuid(i));
    if(result.status!==201)throw new Error(JSON.stringify(result));
    const stored=(await db.query('select calculated_amount_snapshot::text as stored, calculated_amount_snapshot = $2::numeric as sql_equal, (calculated_amount_snapshot-$2::numeric)::text as delta, round(calculated_amount_snapshot,2)::text as cents, (calculated_amount_snapshot*10000)::text as ten_thousand_sum from public.shipments where id=$1',[result.body.shipment.id,exact])).rows[0];
    console.log(JSON.stringify({price,weight,expected:exact,edgeValue:result.body.shipment.calculated_amount_snapshot,jsEqual:result.body.shipment.calculated_amount_snapshot===Number(exact),ui:context.format(result.body.shipment),...stored}));
  }
} finally {await db.close();}
