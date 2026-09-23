-- Repeatable post-migration compatibility probe; NOT a staged migration rehearsal.
-- Dedicated test project only. One DO statement rolls back all fixtures on error.
do $test$
declare
  expected_project constant text := 'zfcsuxihpakrsohvcwlr';
  suffix text := replace(gen_random_uuid()::text, '-', '');
  v_product_id uuid;
  v_price_id uuid;
  v_shipment_id uuid;
  v_vendor_name text := 'CODEX_T019_' || suffix;
begin
  perform 1 from test_guard.project_identity where project_ref = expected_project;
  if not found or not exists (select 1 from storage.buckets where id = 'factory-photos-test')
      or exists (select 1 from storage.buckets where id = 'factory-photos') then
    raise exception 'T019 legacy writes require the dedicated test project';
  end if;

  -- Use only fields supported by the historical callers, leaving new fields out.
  insert into public.products (name, material)
  values ('CODEX_T019_PRODUCT_' || suffix, 'legacy material') returning id into v_product_id;
  insert into public.vendor_prices (vendor_name, product_id, unit, unit_price, effective_date)
  values (v_vendor_name, v_product_id, 'kg', 70, date '2026-01-01') returning id into v_price_id;
  insert into public.shipments (vendor_name, item_name, product_id, location, status)
  values (v_vendor_name, 'legacy shipment', v_product_id, '蘆洲', '未開始') returning id into v_shipment_id;

  if not exists (
    select 1 from public.products where id = v_product_id and material = 'legacy material'
      and quick_create_request_id is null and quick_create_request_fingerprint is null
  ) or not exists (
    select 1 from public.vendor_prices where id = v_price_id and unit_price = 70
      and end_date is null and product_id = v_product_id
  ) or not exists (
    select 1 from public.shipments where id = v_shipment_id and product_id = v_product_id
      and create_request_id is null and create_request_fingerprint is null
  ) then
    raise exception 'T019 historical field values or defaults changed';
  end if;

  update public.products set material = 'legacy edit' where id = v_product_id;
  update public.vendor_prices set note = 'legacy edit' where id = v_price_id;
  update public.shipments set note = 'legacy edit' where id = v_shipment_id;
  if not exists (select 1 from public.products where id = v_product_id and material = 'legacy edit')
      or not exists (select 1 from public.vendor_prices where id = v_price_id and note = 'legacy edit' and end_date is null)
      or not exists (select 1 from public.shipments where id = v_shipment_id and note = 'legacy edit') then
    raise exception 'T019 historical updates are no longer readable';
  end if;

  delete from public.shipments where id = v_shipment_id;
  delete from public.vendor_prices where id = v_price_id;
  delete from public.products where id = v_product_id;
  if exists (select 1 from public.shipments where id = v_shipment_id)
      or exists (select 1 from public.vendor_prices where id = v_price_id)
      or exists (select 1 from public.products where id = v_product_id) then
    raise exception 'T019 fixture cleanup failed';
  end if;
  raise notice 'T019 POSTMIGRATION PASS';
end
$test$;
