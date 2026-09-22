-- Changing a price row must not alter the already-stored shipment snapshot.
do $test$
declare v_snapshot numeric;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T011 unsafe project'; end if;
  insert into public.vendors (id,short_name)
  values ('c0d00000-0000-4000-8000-000000000001','[TEST] snapshot vendor');
  insert into public.products (id,name)
  values ('c0d00000-0000-4000-8000-000000000002','[TEST] snapshot product');
  insert into public.vendor_prices (id,vendor_name,vendor_id,product_id,unit_price,effective_date)
  values ('c0d00000-0000-4000-8000-000000000003','[TEST] snapshot vendor',
    'c0d00000-0000-4000-8000-000000000001',
    'c0d00000-0000-4000-8000-000000000002',70,'2025-03-01');
  insert into public.shipments
    (id,vendor_name,vendor_id,item_name,product_id,location,status,unit_price_snapshot,unit_snapshot)
  values
    ('c0d00000-0000-4000-8000-000000000115','[TEST] snapshot vendor',
      'c0d00000-0000-4000-8000-000000000001','[TEST] snapshot product',
      'c0d00000-0000-4000-8000-000000000002','蘆洲','已出貨',70,'kg');
  update public.vendor_prices set unit_price=50
  where id='c0d00000-0000-4000-8000-000000000003';
  select unit_price_snapshot into v_snapshot from public.shipments
  where id='c0d00000-0000-4000-8000-000000000115';
  if v_snapshot is distinct from 70 then
    raise exception 'T011 FAIL: snapshot expected 70, actual %',v_snapshot;
  end if;
  update public.vendor_prices set unit_price=70
  where id='c0d00000-0000-4000-8000-000000000003';
  delete from public.shipments where id='c0d00000-0000-4000-8000-000000000115';
  delete from public.vendor_prices where id='c0d00000-0000-4000-8000-000000000003';
  delete from public.products where id='c0d00000-0000-4000-8000-000000000002';
  delete from public.vendors where id='c0d00000-0000-4000-8000-000000000001';
end
$test$;
select 'T011 PASS' as result;
