begin;

-- One workbook = one transaction. Never overwrite existing vendors or sites.
-- Serialization covers imports and waits for existing vendor/site writes before deduplication.
-- A lost response is safely retried by importing the same rows: committed rows are skipped.
create function public.import_vendor_workbook(p_rows jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s'
as $$
declare
  r jsonb; k text; v_parent uuid; v_added integer := 0; v_sites integer := 0; v_skipped integer := 0;
begin
  if not coalesce(private.is_factory_admin(), false) then
    raise exception 'Active administrator required' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Expected workbook row array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 5000 or octet_length(p_rows::text) > 2200000 then
    raise exception 'Workbook exceeds row or size limit' using errcode = '22023';
  end if;
  -- Validate the entire request before taking write locks. No caller-supplied IDs or references.
  for r in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(r) <> 'object' or nullif(btrim(r->>'code'),'') is null or nullif(btrim(r->>'short_name'),'') is null
       or jsonb_typeof(r->'is_active') is distinct from 'boolean' then
      raise exception 'Invalid workbook row' using errcode = '22023';
    end if;
    for k in select jsonb_object_keys(r) loop
      if k <> all(array['code','short_name','invoice_title','billing_mode','tax_id','contact_name','phone','fax','address','email','billing_address','note','source_note','site_note','is_active']) then
        raise exception 'Unexpected workbook field' using errcode = '22023';
      end if;
      if k <> 'is_active' and (jsonb_typeof(r->k) not in ('string','null') or length(r->>k) > 10000) then
        raise exception 'Invalid workbook field' using errcode = '22023';
      end if;
    end loop;
  end loop;
  lock table public.vendors, public.vendor_sites in share row exclusive mode;
  for r in select value from jsonb_array_elements(p_rows) loop
    v_parent := null;
    if nullif(r->>'tax_id','') is not null and nullif(r->>'invoice_title','') is not null then
      select id into v_parent from public.vendors
      where tax_id = r->>'tax_id' and invoice_title = r->>'invoice_title'
      order by code nulls last, id limit 1;
    end if;
    if v_parent is not null and ((r->>'short_name') ~* '二廠|三廠|CNC|分廠' or (r->>'code') ~* '-P[0-9]*$') then
      if exists(select 1 from public.vendor_sites where vendor_id = v_parent
                and (site_code = r->>'code' or site_name = r->>'short_name')) then
        v_skipped := v_skipped + 1;
      else
        insert into public.vendor_sites(vendor_id,site_code,site_name,contact_name,phone,fax,address,email,note)
        values(v_parent,r->>'code',r->>'short_name',r->>'contact_name',r->>'phone',r->>'fax',r->>'address',r->>'email',r->>'site_note');
        v_sites := v_sites + 1;
      end if;
    elsif exists(select 1 from public.vendors where
                  (code = r->>'code' and short_name = r->>'short_name') or
                  (nullif(r->>'tax_id','') is not null and nullif(r->>'invoice_title','') is not null and nullif(r->>'address','') is not null
                   and tax_id = r->>'tax_id' and invoice_title = r->>'invoice_title' and address = r->>'address')) then
      v_skipped := v_skipped + 1;
    else
      insert into public.vendors(code,short_name,invoice_title,billing_mode,tax_id,contact_name,phone,fax,address,email,billing_address,note,source_note,is_active)
      values(r->>'code',r->>'short_name',r->>'invoice_title',r->>'billing_mode',r->>'tax_id',r->>'contact_name',r->>'phone',r->>'fax',r->>'address',r->>'email',r->>'billing_address',r->>'note',r->>'source_note',(r->>'is_active')::boolean);
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added',v_added,'site_added',v_sites,'skipped',v_skipped,'total',jsonb_array_length(p_rows));
end $$;
revoke all on function public.import_vendor_workbook(jsonb) from public, anon, service_role;
grant execute on function public.import_vendor_workbook(jsonb) to authenticated;

commit;
