-- T031: quick product retries return the first product and preserve the old RPC.
begin;
do $guard$
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T031 unsafe project'; end if;
end
$guard$;

insert into auth.users (id,email) values
  ('c0d00000-0000-4000-8000-000000000311','t031-admin@example.invalid'),
  ('c0d00000-0000-4000-8000-000000000312','t031-staff@example.invalid');
insert into public.profiles (user_id,email,role,active) values
  ('c0d00000-0000-4000-8000-000000000311','t031-admin@example.invalid','admin',true),
  ('c0d00000-0000-4000-8000-000000000312','t031-staff@example.invalid','staff',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000311',true);
do $test$
declare
  v_request_id constant uuid := 'c0d00000-0000-4000-8000-000000000313';
  v_first jsonb;
  v_retry jsonb;
  v_legacy public.products%rowtype;
  v_rejected boolean := false;
begin
  v_first := public.create_product_with_initial_price_idempotent(
    v_request_id, '[TEST] T031 retry product', 'steel', 'process', null,
    '[TEST] T031 vendor', null, 50, 70, 'kg', current_date
  );
  v_retry := public.create_product_with_initial_price_idempotent(
    v_request_id, '[TEST] T031 retry product', 'steel', 'process', null,
    '[TEST] T031 vendor', null, 50, 70, 'kg', current_date
  );
  if (v_first ->> 'replayed')::boolean or not (v_retry ->> 'replayed')::boolean
     or v_first #>> '{product,id}' is distinct from v_retry #>> '{product,id}' then
    raise exception 'T031 retry did not return the first product';
  end if;
  if (select count(*) from public.products where quick_create_request_id = v_request_id) <> 1
     or (select count(*) from public.vendor_prices
         where product_id = (v_first #>> '{product,id}')::uuid) <> 1 then
    raise exception 'T031 retry created duplicate product or price rows';
  end if;

  begin
    perform public.create_product_with_initial_price_idempotent(
      v_request_id, '[TEST] T031 changed product', 'steel', 'process', null,
      '[TEST] T031 vendor', null, 50, 70, 'kg', current_date
    );
  exception when sqlstate 'PT409' then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'T031 reused request ID with changed data was not rejected';
  end if;

  -- The pre-idempotency function must remain callable and leave new columns null.
  select * into v_legacy from public.create_product_with_initial_price(
    '[TEST] T031 legacy product', null, null, null,
    '[TEST] T031 vendor', null, 60, null, 'kg', current_date
  );
  if v_legacy.quick_create_request_id is not null
     or v_legacy.quick_create_request_fingerprint is not null then
    raise exception 'T031 legacy RPC unexpectedly populated idempotency columns';
  end if;

  perform set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000312',true);
  v_rejected := false;
  begin
    perform public.create_product_with_initial_price_idempotent(
      gen_random_uuid(), '[TEST] T031 staff product', null, null, null,
      '[TEST] T031 vendor', null, 50, null, 'kg', current_date
    );
  exception when raise_exception then
    if sqlerrm = 'Admin only' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'T031 staff could create a quick product'; end if;
end
$test$;

rollback;
select 'T031 PASS' as result;
