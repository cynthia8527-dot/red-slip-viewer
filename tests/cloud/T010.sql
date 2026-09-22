-- Same vendor code + short_name, or same dispatch name + address, cannot duplicate.
-- A missing vendor code counts as the same value when both short names match.
do $test$
declare v_vendor_rejected boolean := false;
  v_null_code_rejected boolean := false;
  v_dispatch_rejected boolean := false;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T010 unsafe project'; end if;
  begin
    insert into public.vendors (id,code,short_name)
    values ('c0d00000-0000-4000-8000-000000000111','[TEST]-duplicate','[TEST] duplicate vendor');
    insert into public.vendors (id,code,short_name)
    values ('c0d00000-0000-4000-8000-000000000112','[TEST]-duplicate','[TEST] duplicate vendor');
  exception when unique_violation then v_vendor_rejected := true;
  end;
  begin
    insert into public.vendors (id,code,short_name)
    values ('c0d00000-0000-4000-8000-000000000120',null,'[TEST] no code');
    insert into public.vendors (id,code,short_name)
    values ('c0d00000-0000-4000-8000-000000000121',null,'[TEST] no code');
  exception when unique_violation then v_null_code_rejected := true;
  end;
  -- One field alone is not enough to define a duplicate.
  insert into public.vendors (id,code,short_name) values
    ('c0d00000-0000-4000-8000-000000000122','[TEST]-same-code','[TEST] first'),
    ('c0d00000-0000-4000-8000-000000000123','[TEST]-same-code','[TEST] second'),
    ('c0d00000-0000-4000-8000-000000000124','[TEST]-other-code','[TEST] first');
  begin
    insert into public.dispatch_locations (id,name,address)
    values ('c0d00000-0000-4000-8000-000000000113','[TEST] duplicate dispatch','[TEST] same address');
    insert into public.dispatch_locations (id,name,address)
    values ('c0d00000-0000-4000-8000-000000000114','[TEST] duplicate dispatch','[TEST] same address');
  exception when unique_violation then v_dispatch_rejected := true;
  end;
  insert into public.dispatch_locations (id,name,address) values
    ('c0d00000-0000-4000-8000-000000000125','[TEST] same name','[TEST] address A'),
    ('c0d00000-0000-4000-8000-000000000126','[TEST] same name','[TEST] address B'),
    ('c0d00000-0000-4000-8000-000000000127','[TEST] other name','[TEST] address A');
  if not v_vendor_rejected or not v_null_code_rejected or not v_dispatch_rejected then
    raise exception 'T010 FAIL: vendor duplicate rejected %, null-code duplicate rejected %, dispatch duplicate rejected %',
      v_vendor_rejected,v_null_code_rejected,v_dispatch_rejected;
  end if;
  delete from public.vendors where id in (
    'c0d00000-0000-4000-8000-000000000122',
    'c0d00000-0000-4000-8000-000000000123',
    'c0d00000-0000-4000-8000-000000000124'
  );
  delete from public.dispatch_locations where id in (
    'c0d00000-0000-4000-8000-000000000125',
    'c0d00000-0000-4000-8000-000000000126',
    'c0d00000-0000-4000-8000-000000000127'
  );
end
$test$;
select 'T010 PASS' as result;
