-- Foreign keys must reject references to nonexistent vendor and shipment IDs.
do $test$
declare v_price_rejected boolean := false; v_photo_rejected boolean := false;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T009 unsafe project'; end if;
  insert into public.products (id,name)
  values ('c0d00000-0000-4000-8000-000000000002','[TEST] FK product');
  begin
    insert into public.vendor_prices (id,vendor_name,vendor_id,product_id,unit_price)
    values ('c0d00000-0000-4000-8000-000000000109','[TEST] invalid',
      'c0d00000-0000-4000-8000-000000000999','c0d00000-0000-4000-8000-000000000002',1);
  exception when foreign_key_violation then v_price_rejected := true;
  end;
  begin
    insert into public.shipment_photos (id,shipment_id,storage_path)
    values ('c0d00000-0000-4000-8000-000000000110',
      'c0d00000-0000-4000-8000-000000000999',
      'shipments/c0d00000-0000-4000-8000-000000000999/test.svg');
  exception when foreign_key_violation then v_photo_rejected := true;
  end;
  if not v_price_rejected or not v_photo_rejected then
    raise exception 'T009 FAIL: invalid vendor rejected %, invalid shipment photo rejected %',
      v_price_rejected,v_photo_rejected;
  end if;
  delete from public.products where id='c0d00000-0000-4000-8000-000000000002';
end
$test$;
select 'T009 PASS' as result;
