-- Real RPC regression: keep old price, close its date range, reject duplicate replacement.
-- Test records and test-only Auth account are removed on success; a failure rolls
-- back the entire DO statement.
do $test$
declare
  v_admin uuid := 'c0d00000-0000-4000-8000-000000000004';
  v_old uuid := 'c0d00000-0000-4000-8000-000000000003';
  v_new public.vendor_prices%rowtype;
  v_duplicate_rejected boolean := false;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T018 unsafe project'; end if;

  insert into public.vendors (id,short_name)
  values ('c0d00000-0000-4000-8000-000000000001','[TEST] price vendor');
  insert into public.products (id,name)
  values ('c0d00000-0000-4000-8000-000000000002','[TEST] price product');
  insert into public.vendor_prices (id,vendor_name,vendor_id,product_id,unit_price,effective_date)
  values (v_old,'[TEST] price vendor',
    'c0d00000-0000-4000-8000-000000000001',
    'c0d00000-0000-4000-8000-000000000002',70,'2025-03-01');
  insert into auth.users (id,email)
  values (v_admin,'codex-cloud-test@example.invalid');
  insert into public.profiles (user_id,email,role,active)
  values (v_admin,'codex-cloud-test@example.invalid','admin',true);
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  if not private.is_factory_admin() then raise exception 'T018 admin profile not recognized'; end if;

  v_new := public.replace_vendor_price(v_old,50,null,'kg',null,date '2026-09-11','[TEST] lower price');
  if v_new.unit_price <> 50 or v_new.effective_date <> date '2026-09-11' then
    raise exception 'T018 FAIL: new price mismatch';
  end if;
  if not exists (
    select 1 from public.vendor_prices
    where id=v_old and unit_price=70 and end_date=date '2026-09-10'
  ) then raise exception 'T018 FAIL: old price overwritten or end date wrong'; end if;

  begin
    perform public.replace_vendor_price(v_old,60,null,'kg',null,date '2026-09-11','[TEST] duplicate');
  exception when others then v_duplicate_rejected := true;
  end;
  if not v_duplicate_rejected or
     (select count(*) from public.vendor_prices where vendor_name='[TEST] price vendor') <> 2 then
    raise exception 'T018 FAIL: duplicate replacement changed history';
  end if;

  delete from public.vendor_prices where id=v_new.id;
  delete from public.vendor_prices where id=v_old;
  delete from public.products where id='c0d00000-0000-4000-8000-000000000002';
  delete from public.vendors where id='c0d00000-0000-4000-8000-000000000001';
  delete from public.profiles where user_id=v_admin;
  delete from auth.users where id=v_admin;
end
$test$;
select 'T018 PASS' as result;
