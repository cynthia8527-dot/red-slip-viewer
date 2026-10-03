-- T027: quick product/price RPC is atomic and admin-only under real RLS.
-- All synthetic Auth and business rows roll back with this transaction.
begin;
do $guard$
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T027 unsafe project'; end if;
end
$guard$;

insert into auth.users (id,email) values
  ('c0d00000-0000-4000-8000-000000000271','t027-admin@example.invalid'),
  ('c0d00000-0000-4000-8000-000000000272','t027-staff@example.invalid');
insert into public.profiles (user_id,email,role,active) values
  ('c0d00000-0000-4000-8000-000000000271','t027-admin@example.invalid','admin',true),
  ('c0d00000-0000-4000-8000-000000000272','t027-staff@example.invalid','staff',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000271',true);
do $test$
declare
  v_product public.products%rowtype;
  v_rejected boolean := false;
begin
  select * into v_product from public.create_product_with_initial_price(
    '[TEST] T027 valid product', null, 'process', null,
    '[TEST] T027 vendor', null, 50, 70, 'kg', current_date
  );
  if v_product.id is null or (select count(*) from public.vendor_prices
      where product_id=v_product.id and unit_price=50 and minimum_charge=70) <> 1 then
    raise exception 'T027 FAIL: valid product has no linked initial price';
  end if;

  begin
    perform public.create_product_with_initial_price(
      '[TEST] T027 orphan product', null, null, null,
      '[TEST] T027 vendor', 'c0d00000-0000-4000-8000-000000000999',
      50, null, 'kg', current_date
    );
  exception when foreign_key_violation then v_rejected := true;
  end;
  if not v_rejected or exists (select 1 from public.products where name='[TEST] T027 orphan product') then
    raise exception 'T027 FAIL: failed price insert left an orphan product';
  end if;

  perform set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000272',true);
  v_rejected := false;
  begin
    perform public.create_product_with_initial_price(
      '[TEST] T027 staff product', null, null, null,
      '[TEST] T027 vendor', null, 50, null, 'kg', current_date
    );
  exception when raise_exception then
    if sqlerrm = 'Admin only' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected or exists (select 1 from public.products where name='[TEST] T027 staff product') then
    raise exception 'T027 FAIL: staff could create an admin-only quick product';
  end if;
end
$test$;

rollback;
select 'T027 PASS' as result;
