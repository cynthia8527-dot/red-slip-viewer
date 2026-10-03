-- Test-project-only trial. This is not an approved main-environment migration.
do $guard$
begin
  perform 1 from test_guard.project_identity
  where project_ref = 'zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'Unsafe project for quick product trial'; end if;
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test') then
    raise exception 'Test photo bucket is missing';
  end if;
end
$guard$;

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
