import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageProbe } from '../cloud/storage-probe.mjs';
// Real HTTP calls to the disposable platform, including the unmodified repository Edge sources.
export async function exerciseWorkflow({api,sql,token,productId}) {
  const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZl8AAAAASUVORK5CYII=','base64');
  const call=async(path,opts={})=>(await api(path,{token,...opts})).json();
  const probe=createStorageProbe(async(path,opts)=>{
    const r=await api(path,{...opts,ok:false});
    return {status:r.status,data:r.ok?null:await r.json()};
  },'factory-photos');
  for(let n=0;n<40;n++){
    const ready=await api('/functions/v1/shipments',{token,ok:false});
    if(ready.status===200)break;
    if(n===39)throw new Error(`Local Edge startup failed HTTP ${ready.status}`);
    await new Promise(r=>setTimeout(r,1000));
  }
  const unauth=await api('/functions/v1/shipments',{token:'invalid',ok:false});
  assert.equal(unauth.status,401,'Edge JWT verification remains enabled');
  const key=randomUUID();
  const body={vendor_name:'rebuild vendor',item_name:'End-to-end shipment',product_id:productId,weight_kg:3,location:'蘆洲',status:'已出貨',intake_group_label:'Synthetic workflow group',received_date:'2026-09-30'};
  const create=()=>call('/functions/v1/shipments',{method:'POST',body,headers:{'Idempotency-Key':key}});
  const first=await create();
  const id=first.shipment.id;assert.match(id,/^[0-9a-f-]{36}$/);
  assert.equal(first.replayed,false);assert.equal(Number(first.shipment.calculated_amount_snapshot),30);
  const retries=await Promise.all([create(),create()]);
  for(const retry of retries){assert.equal(retry.replayed,true);assert.equal(retry.shipment.id,id);}
  const conflict=await api('/functions/v1/shipments',{token,method:'POST',body:{...body,note:'changed'},headers:{'Idempotency-Key':key},ok:false});
  assert.equal(conflict.status,409);
  const shipmentPath=`shipments/${id}/workflow.png`;
  const missing=await api('/functions/v1/shipments',{token,method:'POST',body:{action:'attach_photo',id,storage_path:shipmentPath},ok:false});
  assert.equal(missing.status,409,'missing object must map to conflict');
  await api('/storage/v1/object/factory-photos/'+shipmentPath,{token,method:'POST',bytes});
  const attachBody={action:'attach_photo',id,storage_path:shipmentPath,caption:'Synthetic workflow'};
  const linked=await call('/functions/v1/shipments',{method:'POST',body:attachBody});
  const linkedAgain=await call('/functions/v1/shipments',{method:'POST',body:attachBody});
  assert.equal(linkedAgain.replayed,true);assert.equal(linked.photo.id,linkedAgain.photo.id);
  const paths=[`products/${productId}/first.png`,`products/${productId}/replacement.png`];
  for(let i=0;i<paths.length;i++){
    await api('/storage/v1/object/factory-photos/'+paths[i],{token,method:'POST',bytes});
    const body={id:productId,storage_path:paths[i],previous_storage_path:i?paths[0]:null};
    const photo=await call('/functions/v1/product-photos',{method:'POST',body});
    assert.equal(photo.previous_cleanup_pending,false);assert.equal(photo.product.reference_photo_path,paths[i]);
    const retry=await call('/functions/v1/product-photos',{method:'POST',body});
    assert.equal(retry.replayed,true);assert.equal(retry.previous_cleanup_pending,false);
  }
  await probe.waitForAbsent(paths[0],token);
  const image=await api('/storage/v1/object/authenticated/factory-photos/'+paths[1],{token});
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),bytes);
  // A later catalog price must not rewrite the posted shipment's captured amount.
  await sql(`update public.vendor_prices set unit_price=120 where product_id='${productId}';`);
  const ledger=await call('/functions/v1/shipments');
  assert.equal(ledger.shipments.length,1);assert.equal(ledger.shipments[0].id,id);
  assert.equal(Number(ledger.shipments[0].unit_price_snapshot),10);
  assert.equal(Number(ledger.shipments[0].calculated_amount_snapshot),30);
  const photos=await call('/rest/v1/shipment_photos?select=id,storage_path');
  assert.equal(photos.length,1);assert.equal(photos[0].storage_path,shipmentPath);
  const shipmentImage=await api('/storage/v1/object/authenticated/factory-photos/'+shipmentPath,{token});
  assert.deepEqual(Buffer.from(await shipmentImage.arrayBuffer()),bytes);
  console.log('PASS upgraded workflow: post shipment → upload/replace photos → concurrent idempotent retries → query ledger with preserved amount and one photo');
  await call('/functions/v1/shipments',{method:'PATCH',body:{action:'void',id,reason:'Synthetic workflow cleanup'}});
  const deleted=await call('/functions/v1/shipments',{method:'DELETE',body:{id}});
  assert.equal(deleted.cleanup_pending,false);
  const deletedAgain=await call('/functions/v1/shipments',{method:'DELETE',body:{id}});
  assert.equal(deletedAgain.replayed,true);assert.equal(deletedAgain.cleanup_pending,false);
  await probe.waitForAbsent(shipmentPath,token);
  await api('/storage/v1/object/factory-photos',{token,method:'DELETE',body:{prefixes:[paths[1]]}});
  await probe.waitForAbsent(paths[1],token);
  // Finished deletion jobs and empty groups are retained by product design; remove only this fixture.
  await sql(`delete from private.shipment_deletion_jobs where shipment_id='${id}'; delete from public.intake_groups where id='${first.shipment.intake_group_id}';`);
  console.log('PASS workflow deletion/retry cleanup: old/current images absent by metadata and bytes');
}
