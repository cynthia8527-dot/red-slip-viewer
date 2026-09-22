-- Two otherwise identical records with different generated IDs must not duplicate.
-- This is a confirmed desired rule; the exact uniqueness rule needs product approval.
do $test$
declare v_vendor_rejected boolean := false; v_dispatch_rejected boolean := false;
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
    insert into public.dispatch_locations (id,name,address)
    values ('c0d00000-0000-4000-8000-000000000113','[TEST] duplicate dispatch','[TEST] same address');
    insert into public.dispatch_locations (id,name,address)
    values ('c0d00000-0000-4000-8000-000000000114','[TEST] duplicate dispatch','[TEST] same address');
  exception when unique_violation then v_dispatch_rejected := true;
  end;
  if not v_vendor_rejected or not v_dispatch_rejected then
    raise exception 'T010 FAIL: vendor duplicate rejected %, dispatch duplicate rejected %',
      v_vendor_rejected,v_dispatch_rejected;
  end if;
end
$test$;
select 'T010 PASS' as result;
