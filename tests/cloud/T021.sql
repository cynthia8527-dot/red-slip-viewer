-- A shipment photo path must not claim a different shipment's directory.
do $test$
declare v_rejected boolean := false; v_update_rejected boolean := false;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T021 unsafe project'; end if;
  insert into public.shipments
    (id,vendor_name,item_name,location)
  values
    ('c0d00000-0000-4000-8000-000000000118','[TEST] vendor','[TEST] item','蘆洲');
  begin
    insert into public.shipment_photos (id,shipment_id,storage_path)
    values ('c0d00000-0000-4000-8000-000000000119',
      'c0d00000-0000-4000-8000-000000000118',
      'shipments/c0d00000-0000-4000-8000-000000000999/wrong.svg');
  exception when check_violation then v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'T021 FAIL: photo path for another shipment was accepted';
  end if;
  insert into public.shipment_photos (id,shipment_id,storage_path)
  values ('c0d00000-0000-4000-8000-000000000128',
    'c0d00000-0000-4000-8000-000000000118',
    'shipments/c0d00000-0000-4000-8000-000000000118/valid.svg');
  begin
    update public.shipment_photos
    set storage_path='shipments/c0d00000-0000-4000-8000-000000000999/wrong.svg'
    where id='c0d00000-0000-4000-8000-000000000128';
  exception when check_violation then v_update_rejected := true;
  end;
  if not v_update_rejected then
    raise exception 'T021 FAIL: photo path could be changed to another shipment';
  end if;
  delete from public.shipments where id='c0d00000-0000-4000-8000-000000000118';
end
$test$;
select 'T021 PASS' as result;
