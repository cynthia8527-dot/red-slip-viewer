-- Vendor edits must not change dispatch locations. Test rows are removed on success.
do $test$
declare v_name text;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T008 unsafe project'; end if;
  insert into public.vendors (id,code,short_name)
  values ('c0d00000-0000-4000-8000-000000000101','[TEST]-T008','[TEST] vendor before');
  insert into public.dispatch_locations (id,name,address)
  values ('c0d00000-0000-4000-8000-000000000102','[TEST] dispatch location','[TEST] address');
  update public.vendors set short_name='[TEST] vendor after'
  where id='c0d00000-0000-4000-8000-000000000101';
  select name into v_name from public.dispatch_locations
  where id='c0d00000-0000-4000-8000-000000000102';
  if v_name is distinct from '[TEST] dispatch location' then
    raise exception 'T008 FAIL: dispatch name changed to %',v_name;
  end if;
  delete from public.dispatch_locations where id='c0d00000-0000-4000-8000-000000000102';
  delete from public.vendors where id='c0d00000-0000-4000-8000-000000000101';
end
$test$;
select 'T008 PASS' as result;
