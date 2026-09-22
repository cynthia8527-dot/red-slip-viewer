
create or replace function public.replace_vendor_price(
  p_current_price_id uuid,
  p_unit_price numeric,
  p_minimum_charge numeric,
  p_unit text,
  p_process_name text,
  p_effective_date date,
  p_note text
)
returns public.vendor_prices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old public.vendor_prices%rowtype;
  v_new public.vendor_prices%rowtype;
begin
  if not private.is_factory_admin() then
    raise exception 'Admin only';
  end if;

  if p_effective_date is null then
    raise exception 'effective_date is required';
  end if;
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'unit_price must be non-negative';
  end if;
  if p_minimum_charge is not null and p_minimum_charge < 0 then
    raise exception 'minimum_charge must be non-negative';
  end if;

  select *
    into v_old
    from public.vendor_prices
   where id = p_current_price_id
   for update;

  if not found then
    raise exception 'price record not found';
  end if;

  if v_old.effective_date is not null and p_effective_date <= v_old.effective_date then
    raise exception 'new effective date must be after current effective date';
  end if;

  if v_old.end_date is not null and p_effective_date > v_old.end_date then
    raise exception 'new effective date is outside current price period';
  end if;

  update public.vendor_prices
     set end_date = p_effective_date - 1,
         updated_at = now()
   where id = v_old.id;

  insert into public.vendor_prices (
    vendor_name, vendor_id, product_id, process_name, unit,
    unit_price, minimum_charge, effective_date, end_date, note
  )
  values (
    v_old.vendor_name, v_old.vendor_id, v_old.product_id,
    nullif(trim(coalesce(p_process_name, '')), ''),
    coalesce(nullif(trim(coalesce(p_unit, '')), ''), 'kg'),
    p_unit_price, p_minimum_charge, p_effective_date, v_old.end_date,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_new;

  return v_new;
end;
$$;

revoke all on function public.replace_vendor_price(uuid,numeric,numeric,text,text,date,text) from public;
revoke all on function public.replace_vendor_price(uuid,numeric,numeric,text,text,date,text) from anon;
grant execute on function public.replace_vendor_price(uuid,numeric,numeric,text,text,date,text) to authenticated;
