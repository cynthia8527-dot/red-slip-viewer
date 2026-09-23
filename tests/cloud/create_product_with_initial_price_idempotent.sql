-- Test-project-only trial. This is not an approved main-environment migration.
do $guard$
begin
  perform 1 from test_guard.project_identity
  where project_ref = 'zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'Unsafe project for idempotent quick product trial'; end if;
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test') then
    raise exception 'Test photo bucket is missing';
  end if;
end
$guard$;

alter table public.products
  add column if not exists quick_create_request_id uuid,
  add column if not exists quick_create_request_fingerprint text;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_quick_create_request_pair'
  ) then
    alter table public.products
      add constraint products_quick_create_request_pair check (
        (quick_create_request_id is null and quick_create_request_fingerprint is null)
        or
        (quick_create_request_id is not null and quick_create_request_fingerprint is not null)
      );
  end if;
end
$constraints$;

create unique index if not exists products_quick_create_request_id_idx
  on public.products (quick_create_request_id)
  where quick_create_request_id is not null;

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
    unit, process_name, effective_date
  ) values (
    btrim(p_vendor_name), p_vendor_id, v_product.id, p_unit_price,
    p_minimum_charge, coalesce(nullif(btrim(p_unit), ''), 'kg'),
    nullif(btrim(p_standard_process), ''), p_effective_date
  );
  return jsonb_build_object('product', to_jsonb(v_product), 'replayed', false);
end
$function$;

revoke all on function public.create_product_with_initial_price_idempotent(uuid,text,text,text,text,text,uuid,numeric,numeric,text,date) from public, anon;
grant execute on function public.create_product_with_initial_price_idempotent(uuid,text,text,text,text,text,uuid,numeric,numeric,text,date) to authenticated;
