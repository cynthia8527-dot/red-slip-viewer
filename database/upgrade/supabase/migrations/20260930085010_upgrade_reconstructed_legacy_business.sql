-- Candidate for the explicitly reconstructed legacy boundary only, not a production release.
-- No baseline, data rewriting, backfill, deduplication, or object deletion.
begin;
set local lock_timeout = '5s';
do $preflight$
begin
  if to_regclass('public.dispatch_locations') is null or to_regclass('public.shipments') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'Unsupported legacy boundary: required schema/dependency missing';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public'
      and ((table_name='shipments' and column_name in ('create_request_id','create_request_fingerprint'))
      or (table_name='products' and column_name in ('quick_create_request_id','quick_create_request_fingerprint')))) then
    raise exception 'Unsupported legacy boundary: request columns already present';
  end if;
  if exists (select 1 from public.vendors group by code,short_name having count(*)>1) then
    raise exception 'Legacy duplicate vendor pairs require review';
  end if;
  if exists (select 1 from public.dispatch_locations group by name,address having count(*)>1) then
    raise exception 'Legacy duplicate dispatch pairs require review';
  end if;
  if exists (select 1 from public.shipment_photos
    where left(storage_path,length('shipments/'||shipment_id::text||'/')) <> 'shipments/'||shipment_id::text||'/'
    or length(storage_path)<=length('shipments/'||shipment_id::text||'/')) then
    raise exception 'Legacy shipment photo paths require review';
  end if;
end
$preflight$;
-- Reconstructed on 2026-09-30; not recovered migration history or deployment approval.

-- SOURCE supabase/migrations/20260930040920_add_idempotency_request_columns.sql SHA256 7402bdff1e4decb3a5e4fd9884bfa6518236a9e15a1a251a623fb71209853a53 (verbatim)
-- Review candidate: additive request columns only, not a complete baseline.
-- Does not install RPCs or authorize publishing dependent clients.
-- Deliberately fail on existing columns/indexes; review schema drift first.
set local lock_timeout = '5s';

alter table public.shipments
  add column create_request_id uuid,
  add column create_request_fingerprint text,
  add constraint shipments_create_request_pair_check check (
    (create_request_id is null and create_request_fingerprint is null)
    or (create_request_id is not null and create_request_fingerprint is not null
      and create_request_fingerprint ~ '^[0-9a-f]{64}$')
  );
create unique index shipments_create_request_id_uidx
  on public.shipments (create_request_id) where create_request_id is not null;

alter table public.products
  add column quick_create_request_id uuid,
  add column quick_create_request_fingerprint text,
  add constraint products_quick_create_request_pair check (
    (quick_create_request_id is null and quick_create_request_fingerprint is null)
    or (quick_create_request_id is not null and quick_create_request_fingerprint is not null
      and quick_create_request_fingerprint ~ '^[0-9a-f]{64}$')
  );
create unique index products_quick_create_request_id_idx
  on public.products (quick_create_request_id) where quick_create_request_id is not null;

-- Reconstructed on 2026-09-30; not recovered migration history or deployment approval.
set local lock_timeout = '5s';
-- SOURCE tests/cloud/enforce_confirmed_data_contracts.sql SHA256 5e9738354b25ddd457e541bb6a744d9130b9951bdda9836d2913838d633e0a3f (after-test-guard)
alter table public.vendors
  add constraint vendors_code_short_name_unique
  unique nulls not distinct (code, short_name);

alter table public.dispatch_locations
  add constraint dispatch_locations_name_address_unique
  unique (name, address);

alter table public.shipment_photos
  add constraint shipment_photos_path_matches_shipment
  check (
    left(storage_path, length('shipments/' || shipment_id::text || '/'))
      = 'shipments/' || shipment_id::text || '/'
    and length(storage_path) > length('shipments/' || shipment_id::text || '/')
  );

-- SOURCE tests/cloud/create_shipment_atomic.sql SHA256 aa0e6ad9b37c8f89a7eec72bc755264dfeefe6e9f1ce453d223338541d5f80c9 (rpc-only)
create or replace function public.create_shipment_atomic(
  p_shipment jsonb,
  p_group_label text,
  p_received_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_row public.shipments%rowtype;
  v_saved public.shipments%rowtype;
  v_group_id uuid;
  v_group jsonb;
begin
  select * into v_row from jsonb_populate_record(null::public.shipments, p_shipment);
  if nullif(btrim(v_row.vendor_name), '') is null or nullif(btrim(v_row.item_name), '') is null then
    raise exception 'vendor_name and item_name are required';
  end if;
  if v_row.is_demo is distinct from false then
    raise exception 'Only non-demo shipments are allowed';
  end if;

  v_group_id := v_row.intake_group_id;
  if v_group_id is null and nullif(btrim(p_group_label), '') is not null then
    select id into v_group_id from public.intake_groups
    where is_demo = false and vendor_name = v_row.vendor_name
      and received_date = coalesce(p_received_date, current_date)
      and label = btrim(p_group_label)
    limit 1;
    if v_group_id is null then
      insert into public.intake_groups (vendor_name, received_date, label, is_demo)
      values (v_row.vendor_name, coalesce(p_received_date, current_date), btrim(p_group_label), false)
      returning id into v_group_id;
    end if;
  end if;

  insert into public.shipments (
    vendor_name, vendor_id, item_name, product_id, material, process, boxes,
    weight_kg, weigh_at, location, status, due_date, urgent, note, shipped_at,
    intake_group_id, batch_label, cannot_mix, is_demo, unit_price_snapshot,
    unit_snapshot, minimum_charge_snapshot, calculated_amount_snapshot
  ) values (
    v_row.vendor_name, v_row.vendor_id, v_row.item_name, v_row.product_id,
    v_row.material, v_row.process, v_row.boxes, v_row.weight_kg, v_row.weigh_at,
    v_row.location, v_row.status, v_row.due_date, v_row.urgent, v_row.note,
    v_row.shipped_at, v_group_id, v_row.batch_label, v_row.cannot_mix, false,
    v_row.unit_price_snapshot, v_row.unit_snapshot, v_row.minimum_charge_snapshot,
    v_row.calculated_amount_snapshot
  ) returning * into v_saved;

  if v_group_id is not null then
    select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
      into v_group from public.intake_groups where id = v_group_id;
  end if;
  return to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group);
end
$function$;

revoke all on function public.create_shipment_atomic(jsonb, text, date) from public, anon, authenticated;
grant execute on function public.create_shipment_atomic(jsonb, text, date) to service_role;

-- SOURCE tests/cloud/update_shipment_atomic.sql SHA256 16acde4a010444b4a5f77d15d5f11b845b41a4bfaa69196e1b5a60654026daf7 (rpc-only)
create or replace function public.update_shipment_with_group(
  p_id uuid,
  p_patch jsonb,
  p_requested_group_id uuid,
  p_group_label text,
  p_received_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.shipments%rowtype;
  v_new public.shipments%rowtype;
  v_saved public.shipments%rowtype;
  v_group_id uuid;
  v_group jsonb;
begin
  select * into v_existing from public.shipments
  where id = p_id and is_demo = false for update;
  if not found then raise exception 'shipment not found'; end if;
  if v_existing.voided_at is not null then
    raise exception 'voided shipment must be restored before editing';
  end if;
  select * into v_new from jsonb_populate_record(v_existing, p_patch);

  v_group_id := p_requested_group_id;
  if v_group_id is null and nullif(btrim(p_group_label), '') is not null then
    select id into v_group_id from public.intake_groups
    where is_demo = false and vendor_name = v_new.vendor_name
      and received_date = coalesce(p_received_date, current_date)
      and label = btrim(p_group_label)
    limit 1;
    if v_group_id is null then
      insert into public.intake_groups (vendor_name, received_date, label, is_demo)
      values (v_new.vendor_name, coalesce(p_received_date, current_date), btrim(p_group_label), false)
      returning id into v_group_id;
    end if;
  end if;

  update public.shipments set
    vendor_name = v_new.vendor_name, vendor_id = v_new.vendor_id,
    item_name = v_new.item_name, product_id = v_new.product_id,
    material = v_new.material, process = v_new.process, boxes = v_new.boxes,
    weight_kg = v_new.weight_kg, weigh_at = v_new.weigh_at,
    location = v_new.location, status = v_new.status, due_date = v_new.due_date,
    urgent = v_new.urgent, note = v_new.note, shipped_at = v_new.shipped_at,
    intake_group_id = v_group_id, batch_label = v_new.batch_label,
    cannot_mix = v_new.cannot_mix,
    unit_price_snapshot = v_new.unit_price_snapshot, unit_snapshot = v_new.unit_snapshot,
    minimum_charge_snapshot = v_new.minimum_charge_snapshot,
    calculated_amount_snapshot = v_new.calculated_amount_snapshot,
    updated_at = v_new.updated_at
  where id = p_id and is_demo = false
  returning * into v_saved;

  if v_group_id is not null then
    select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
      into v_group from public.intake_groups where id = v_group_id;
  end if;
  return to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group);
end
$function$;

revoke all on function public.update_shipment_with_group(uuid, jsonb, uuid, text, date) from public, anon, authenticated;
grant execute on function public.update_shipment_with_group(uuid, jsonb, uuid, text, date) to service_role;

-- SOURCE tests/cloud/create_shipment_idempotent.sql SHA256 8767bb9820903e8ce30d1ec43078816e330c74eacecf12d5e2d6b5ba5a0c2223 (rpc-only)
create or replace function public.create_shipment_idempotent(
  p_shipment jsonb,
  p_group_label text,
  p_received_date date,
  p_request_id uuid,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_row public.shipments%rowtype;
  v_saved public.shipments%rowtype;
  v_group_id uuid;
  v_group jsonb;
begin
  if p_request_id is null or p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'A valid request ID and fingerprint are required';
  end if;

  -- Serialize the same logical request before any group or shipment write.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  select * into v_saved from public.shipments
  where create_request_id = p_request_id;
  if found then
    if v_saved.create_request_fingerprint is distinct from p_request_fingerprint then
      raise exception using errcode = '22023', message = 'Idempotency-Key was already used for different shipment data';
    end if;
    if v_saved.intake_group_id is not null then
      select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
        into v_group from public.intake_groups where id = v_saved.intake_group_id;
    end if;
    return jsonb_build_object(
      'shipment', to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group),
      'replayed', true
    );
  end if;

  select * into v_row from jsonb_populate_record(null::public.shipments, p_shipment);
  if nullif(btrim(v_row.vendor_name), '') is null or nullif(btrim(v_row.item_name), '') is null then
    raise exception 'vendor_name and item_name are required';
  end if;
  if v_row.is_demo is distinct from false then
    raise exception 'Only non-demo shipments are allowed';
  end if;

  v_group_id := v_row.intake_group_id;
  if v_group_id is null and nullif(btrim(p_group_label), '') is not null then
    select id into v_group_id from public.intake_groups
    where is_demo = false and vendor_name = v_row.vendor_name
      and received_date = coalesce(p_received_date, current_date)
      and label = btrim(p_group_label)
    limit 1;
    if v_group_id is null then
      insert into public.intake_groups (vendor_name, received_date, label, is_demo)
      values (v_row.vendor_name, coalesce(p_received_date, current_date), btrim(p_group_label), false)
      returning id into v_group_id;
    end if;
  end if;

  insert into public.shipments (
    vendor_name, vendor_id, item_name, product_id, material, process, boxes,
    weight_kg, weigh_at, location, status, due_date, urgent, note, shipped_at,
    intake_group_id, batch_label, cannot_mix, is_demo, unit_price_snapshot,
    unit_snapshot, minimum_charge_snapshot, calculated_amount_snapshot,
    create_request_id, create_request_fingerprint
  ) values (
    v_row.vendor_name, v_row.vendor_id, v_row.item_name, v_row.product_id,
    v_row.material, v_row.process, v_row.boxes, v_row.weight_kg, v_row.weigh_at,
    v_row.location, v_row.status, v_row.due_date, v_row.urgent, v_row.note,
    v_row.shipped_at, v_group_id, v_row.batch_label, v_row.cannot_mix, false,
    v_row.unit_price_snapshot, v_row.unit_snapshot, v_row.minimum_charge_snapshot,
    v_row.calculated_amount_snapshot, p_request_id, p_request_fingerprint
  ) returning * into v_saved;

  if v_group_id is not null then
    select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
      into v_group from public.intake_groups where id = v_group_id;
  end if;
  return jsonb_build_object(
    'shipment', to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group),
    'replayed', false
  );
end
$function$;

revoke all on function public.create_shipment_idempotent(jsonb, text, date, uuid, text) from public, anon, authenticated;
grant execute on function public.create_shipment_idempotent(jsonb, text, date, uuid, text) to service_role;

-- SOURCE tests/cloud/create_product_with_initial_price.sql SHA256 587c637dd0204c46b8555c8416f3e2d4cf83c28580663f41b4bda050e0120e2a (rpc-only)
create or replace function public.create_product_with_initial_price(
  p_name text,
  p_material text,
  p_standard_process text,
  p_process_notes text,
  p_vendor_name text,
  p_vendor_id uuid,
  p_unit_price numeric,
  p_minimum_charge numeric,
  p_unit text,
  p_effective_date date
)
returns public.products
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
begin
  if not private.is_factory_admin() then
    raise exception 'Admin only';
  end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_vendor_name), '') is null then
    raise exception 'Product and vendor names are required';
  end if;
  if p_unit_price is null or p_unit_price < 0 or
     (p_minimum_charge is not null and p_minimum_charge < 0) then
    raise exception 'Price and minimum charge must be non-negative';
  end if;
  if p_effective_date is null then raise exception 'Effective date is required'; end if;

  insert into public.products (name, material, standard_process, process_notes)
  values (btrim(p_name), nullif(btrim(p_material), ''),
          nullif(btrim(p_standard_process), ''), nullif(btrim(p_process_notes), ''))
  returning * into v_product;

  insert into public.vendor_prices (
    vendor_name, vendor_id, product_id, unit_price, minimum_charge,
    unit, process_name, effective_date
  ) values (
    btrim(p_vendor_name), p_vendor_id, v_product.id, p_unit_price,
    p_minimum_charge, coalesce(nullif(btrim(p_unit), ''), 'kg'),
    nullif(btrim(p_standard_process), ''), p_effective_date
  );
  return v_product;
end
$function$;

revoke all on function public.create_product_with_initial_price(text,text,text,text,text,uuid,numeric,numeric,text,date) from public, anon;
grant execute on function public.create_product_with_initial_price(text,text,text,text,text,uuid,numeric,numeric,text,date) to authenticated;

-- SOURCE tests/cloud/create_product_with_initial_price_idempotent.sql SHA256 550308b12c2572b8cc853be598429bc2e612b76b7cfc263677e4e1f21b18cc2e (rpc-only)
create or replace function public.create_product_with_initial_price_idempotent(
  p_request_id uuid,
  p_name text,
  p_material text,
  p_standard_process text,
  p_process_notes text,
  p_vendor_name text,
  p_vendor_id uuid,
  p_unit_price numeric,
  p_minimum_charge numeric,
  p_unit text,
  p_vendor_process text,
  p_price_note text,
  p_effective_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_product public.products%rowtype;
  v_fingerprint text;
begin
  if not private.is_factory_admin() then
    raise exception 'Admin only';
  end if;
  if p_request_id is null then raise exception 'Request ID is required'; end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_vendor_name), '') is null then
    raise exception 'Product and vendor names are required';
  end if;
  if p_unit_price is null or p_unit_price < 0 or
     (p_minimum_charge is not null and p_minimum_charge < 0) then
    raise exception 'Price and minimum charge must be non-negative';
  end if;
  if p_effective_date is null then raise exception 'Effective date is required'; end if;

  v_fingerprint := encode(extensions.digest(convert_to(jsonb_build_object(
    'name', btrim(p_name),
    'material', nullif(btrim(p_material), ''),
    'standard_process', nullif(btrim(p_standard_process), ''),
    'process_notes', nullif(btrim(p_process_notes), ''),
    'vendor_name', btrim(p_vendor_name),
    'vendor_id', p_vendor_id,
    'unit_price', p_unit_price,
    'minimum_charge', p_minimum_charge,
    'unit', coalesce(nullif(btrim(p_unit), ''), 'kg'),
    'vendor_process', nullif(btrim(p_vendor_process), ''),
    'price_note', nullif(btrim(p_price_note), ''),
    'effective_date', p_effective_date
  )::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into v_product
  from public.products
  where quick_create_request_id = p_request_id;
  if found then
    if v_product.quick_create_request_fingerprint is distinct from v_fingerprint then
      raise sqlstate 'PT409' using message = 'Request ID was already used for different product data';
    end if;
    return jsonb_build_object('product', to_jsonb(v_product), 'replayed', true);
  end if;

  insert into public.products (
    name, material, standard_process, process_notes,
    quick_create_request_id, quick_create_request_fingerprint
  ) values (
    btrim(p_name), nullif(btrim(p_material), ''),
    nullif(btrim(p_standard_process), ''), nullif(btrim(p_process_notes), ''),
    p_request_id, v_fingerprint
  ) returning * into v_product;

  insert into public.vendor_prices (
    vendor_name, vendor_id, product_id, unit_price, minimum_charge,
    unit, process_name, effective_date, note
  ) values (
    btrim(p_vendor_name), p_vendor_id, v_product.id, p_unit_price,
    p_minimum_charge, coalesce(nullif(btrim(p_unit), ''), 'kg'),
    nullif(btrim(p_vendor_process), ''), p_effective_date,
    nullif(btrim(p_price_note), '')
  );
  return jsonb_build_object('product', to_jsonb(v_product), 'replayed', false);
end
$function$;

revoke all on function public.create_product_with_initial_price_idempotent(uuid,text,text,text,text,text,uuid,numeric,numeric,text,text,text,date) from public, anon;
grant execute on function public.create_product_with_initial_price_idempotent(uuid,text,text,text,text,text,uuid,numeric,numeric,text,text,text,date) to authenticated;

-- SOURCE tests/cloud/delete_shipment_with_cleanup_job.sql SHA256 61ecbdd715f5d87b81e6111a98ec8f4607c080d1f3fb1a880071f54a368704a9 (after-test-guard)
create table if not exists private.shipment_deletion_jobs (
  shipment_id uuid primary key,
  storage_paths text[] not null default '{}',
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  cleanup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on private.shipment_deletion_jobs from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.shipment_deletion_jobs to service_role;

create or replace function public.delete_shipment_with_cleanup_job(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_job private.shipment_deletion_jobs%rowtype;
  v_paths text[];
begin
  select * into v_job
  from private.shipment_deletion_jobs
  where shipment_id = p_id;
  if found then
    return jsonb_build_object(
      'id', v_job.shipment_id,
      'storage_paths', to_jsonb(v_job.storage_paths),
      'cleanup_completed', v_job.cleanup_completed_at is not null,
      'replayed', true
    );
  end if;

  select * into v_shipment
  from public.shipments
  where id = p_id and is_demo = false
  for update;

  if not found then
    -- A concurrent deletion may have committed while this call waited on the row.
    select * into v_job
    from private.shipment_deletion_jobs
    where shipment_id = p_id;
    if found then
      return jsonb_build_object(
        'id', v_job.shipment_id,
        'storage_paths', to_jsonb(v_job.storage_paths),
        'cleanup_completed', v_job.cleanup_completed_at is not null,
        'replayed', true
      );
    end if;
    raise exception 'shipment not found' using errcode = 'P0002';
  end if;
  if v_shipment.voided_at is null then
    raise exception 'void shipment before permanent delete' using errcode = '23514';
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from public.shipment_photos
  where shipment_id = p_id;

  insert into private.shipment_deletion_jobs (shipment_id, storage_paths)
  values (p_id, v_paths)
  returning * into v_job;

  -- The job and relational deletion commit or roll back in the same transaction.
  -- shipment_photos are removed by their existing ON DELETE CASCADE foreign key.
  delete from public.shipments where id = p_id and is_demo = false;
  if not found then raise exception 'shipment delete lost its target'; end if;

  return jsonb_build_object(
    'id', v_job.shipment_id,
    'storage_paths', to_jsonb(v_job.storage_paths),
    'cleanup_completed', false,
    'replayed', false
  );
end
$function$;

create or replace function public.record_shipment_cleanup_result(p_id uuid, p_error text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job private.shipment_deletion_jobs%rowtype;
begin
  update private.shipment_deletion_jobs
  set attempts = attempts + 1,
      last_error = nullif(btrim(p_error), ''),
      cleanup_completed_at = case
        when nullif(btrim(p_error), '') is null then coalesce(cleanup_completed_at, now())
        else cleanup_completed_at
      end,
      updated_at = now()
  where shipment_id = p_id
  returning * into v_job;
  if not found then raise exception 'shipment cleanup job not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', v_job.shipment_id,
    'attempts', v_job.attempts,
    'cleanup_completed', v_job.cleanup_completed_at is not null,
    'last_error', v_job.last_error
  );
end
$function$;

revoke all on function public.delete_shipment_with_cleanup_job(uuid) from public, anon, authenticated;
revoke all on function public.record_shipment_cleanup_result(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_shipment_with_cleanup_job(uuid) to service_role;
grant execute on function public.record_shipment_cleanup_result(uuid, text) to service_role;
commit;
