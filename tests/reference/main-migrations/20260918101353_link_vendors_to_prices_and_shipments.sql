
alter table public.vendor_prices
  add column if not exists vendor_id uuid null references public.vendors(id) on delete restrict;

alter table public.shipments
  add column if not exists vendor_id uuid null references public.vendors(id) on delete set null;

create index if not exists vendor_prices_vendor_id_idx on public.vendor_prices(vendor_id);
create index if not exists shipments_vendor_id_idx on public.shipments(vendor_id);

with unique_names as (
  select short_name, min(id::text)::uuid as id
  from public.vendors
  group by short_name
  having count(*) = 1
)
update public.vendor_prices vp
set vendor_id = u.id
from unique_names u
where vp.vendor_id is null
  and vp.vendor_name = u.short_name;

with unique_names as (
  select short_name, min(id::text)::uuid as id
  from public.vendors
  group by short_name
  having count(*) = 1
)
update public.shipments s
set vendor_id = u.id
from unique_names u
where s.vendor_id is null
  and s.vendor_name = u.short_name;

comment on column public.vendor_prices.vendor_id is
'Formal vendor master reference. vendor_name remains as a display/history fallback.';
comment on column public.shipments.vendor_id is
'Formal vendor master reference. vendor_name remains as a display/history snapshot/fallback.';
