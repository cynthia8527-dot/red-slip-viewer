
create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  code text,
  short_name text not null,
  invoice_title text,
  billing_mode text,
  tax_id text,
  contact_name text,
  phone text,
  fax text,
  address text,
  email text,
  billing_address text,
  note text,
  source_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_sites (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  site_code text,
  site_name text not null,
  contact_name text,
  phone text,
  fax text,
  address text,
  email text,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendors_code_idx on public.vendors(code);
create index if not exists vendors_short_name_idx on public.vendors(short_name);
create index if not exists vendors_tax_id_idx on public.vendors(tax_id);
create index if not exists vendor_sites_vendor_id_idx on public.vendor_sites(vendor_id);

alter table public.vendors enable row level security;
alter table public.vendor_sites enable row level security;

drop policy if exists "vendors active staff read" on public.vendors;
create policy "vendors active staff read"
on public.vendors for select to authenticated
using ((select private.is_active_factory_user()));

drop policy if exists "vendors admin insert" on public.vendors;
create policy "vendors admin insert"
on public.vendors for insert to authenticated
with check ((select private.is_factory_admin()));

drop policy if exists "vendors admin update" on public.vendors;
create policy "vendors admin update"
on public.vendors for update to authenticated
using ((select private.is_factory_admin()))
with check ((select private.is_factory_admin()));

drop policy if exists "vendors admin delete" on public.vendors;
create policy "vendors admin delete"
on public.vendors for delete to authenticated
using ((select private.is_factory_admin()));

drop policy if exists "vendor sites active staff read" on public.vendor_sites;
create policy "vendor sites active staff read"
on public.vendor_sites for select to authenticated
using ((select private.is_active_factory_user()));

drop policy if exists "vendor sites admin insert" on public.vendor_sites;
create policy "vendor sites admin insert"
on public.vendor_sites for insert to authenticated
with check ((select private.is_factory_admin()));

drop policy if exists "vendor sites admin update" on public.vendor_sites;
create policy "vendor sites admin update"
on public.vendor_sites for update to authenticated
using ((select private.is_factory_admin()))
with check ((select private.is_factory_admin()));

drop policy if exists "vendor sites admin delete" on public.vendor_sites;
create policy "vendor sites admin delete"
on public.vendor_sites for delete to authenticated
using ((select private.is_factory_admin()));

grant select on public.vendors, public.vendor_sites to authenticated;
grant insert, update, delete on public.vendors, public.vendor_sites to authenticated;
revoke all on public.vendors, public.vendor_sites from anon;
