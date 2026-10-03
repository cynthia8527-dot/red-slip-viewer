-- Reconstructed on 2026-09-30; not recovered migration history or deployment approval.
-- Requires Supabase-managed auth/storage schemas and roles; only for an empty business schema.
begin;
set local lock_timeout = '5s';
do $empty$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')) then
    raise exception 'Reconstruction baseline requires an empty public business schema';
  end if;
end
$empty$;

-- Explicit platform dependency: the quick-create RPC qualifies extensions.digest().
-- Historical CREATE EXTENSION without a schema is insufficient on an empty database.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $extension$
begin
  if not exists (select 1 from pg_extension e join pg_namespace n on n.oid=e.extnamespace
    where e.extname='pgcrypto' and n.nspname='extensions') then
    raise exception 'pgcrypto must be installed in extensions; review platform drift';
  end if;
end
$extension$;
grant usage on schema extensions to authenticated, service_role;

-- SOURCE tests/reference/main-migrations/20260916154654_create_factory_core_tables.sql SHA256 0581ffa9b0689bbecf8742d6240387c203005f7aa25667e5ae1cd9b634e21dda (verbatim)
create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  material text,
  standard_process text,
  process_notes text,
  reference_photo_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_prices (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  product_id uuid references public.products(id) on delete cascade,
  process_name text,
  unit text not null default 'kg',
  unit_price numeric(12,2) not null,
  effective_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  item_name text not null,
  product_id uuid references public.products(id) on delete set null,
  material text,
  process text,
  boxes text,
  weight_kg numeric(12,3),
  weigh_at text check (weigh_at in ('蘆洲','五股','八里') or weigh_at is null),
  location text not null check (location in ('蘆洲','五股','八里')),
  status text not null default '未開始' check (status in ('未開始','處理中','完成待出貨','已出貨')),
  due_date date,
  urgent boolean not null default false,
  note text,
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipment_photos (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz not null default now()
);

create index if not exists idx_shipments_status on public.shipments(status);
create index if not exists idx_shipments_location on public.shipments(location);
create index if not exists idx_shipments_due_date on public.shipments(due_date);
create index if not exists idx_shipments_product_id on public.shipments(product_id);
create index if not exists idx_vendor_prices_product_id on public.vendor_prices(product_id);
create index if not exists idx_shipment_photos_shipment_id on public.shipment_photos(shipment_id);

alter table public.products enable row level security;
alter table public.vendor_prices enable row level security;
alter table public.shipments enable row level security;
alter table public.shipment_photos enable row level security;

revoke all on public.products from anon, authenticated;
revoke all on public.vendor_prices from anon, authenticated;
revoke all on public.shipments from anon, authenticated;
revoke all on public.shipment_photos from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('factory-photos','factory-photos',false)
on conflict (id) do nothing;


-- SOURCE tests/reference/main-migrations/20260916160324_add_demo_flag_to_shipments.sql SHA256 1a59ad3eb65d86aad1ef45811f0d00fd3020fff77f1f63b20616d593d5739e77 (verbatim)
alter table public.shipments add column if not exists is_demo boolean not null default false;
create index if not exists shipments_is_demo_idx on public.shipments(is_demo);


-- SOURCE tests/reference/main-migrations/20260917020847_add_intake_groups_and_batch_controls.sql SHA256 996d1a7ec6596d175133898665de8e2a7c79fa8f9b009669df8b7cf494aaf6b5 (verbatim)
create table if not exists public.intake_groups (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  received_date date not null default current_date,
  label text,
  note text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.intake_groups enable row level security;
revoke all on table public.intake_groups from anon, authenticated;

alter table public.shipments
  add column if not exists intake_group_id uuid references public.intake_groups(id) on delete set null,
  add column if not exists batch_label text,
  add column if not exists cannot_mix boolean not null default false;

create index if not exists shipments_intake_group_id_idx on public.shipments(intake_group_id);


-- SOURCE tests/reference/main-migrations/20260917022940_add_factory_auth_roles_and_rls.sql SHA256 fe1a59c970465883e705e58db81298f9a95b8d5bb3e8e8b93ca990e779225f6d (verbatim)
create schema if not exists private;

create table if not exists public.allowed_emails (
  email text primary key,
  display_name text,
  role text not null default 'staff' check (role in ('admin','staff')),
  site text check (site is null or site in ('蘆洲','五股','八里')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'staff' check (role in ('admin','staff')),
  site text check (site is null or site in ('蘆洲','五股','八里')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;
alter table public.profiles enable row level security;
revoke all on public.allowed_emails from anon, authenticated;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function private.is_active_factory_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.active = true
  );
$$;

create or replace function private.is_factory_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.active = true and p.role = 'admin'
  );
$$;

revoke all on function private.is_active_factory_user() from public;
revoke all on function private.is_factory_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_active_factory_user() to authenticated;
grant execute on function private.is_factory_admin() to authenticated;

create or replace function private.provision_factory_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.allowed_emails%rowtype;
begin
  select * into a
  from public.allowed_emails
  where lower(email) = lower(new.email)
    and active = true
  limit 1;

  if found then
    insert into public.profiles(user_id,email,display_name,role,site,active,updated_at)
    values(new.id, lower(new.email), a.display_name, a.role, a.site, true, now())
    on conflict (user_id) do update set
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      site = excluded.site,
      active = excluded.active,
      updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function private.provision_factory_profile() from public;

drop trigger if exists factory_profile_after_auth_user on auth.users;
create trigger factory_profile_after_auth_user
after insert or update of email on auth.users
for each row execute function private.provision_factory_profile();

create policy "profiles read self" on public.profiles
for select to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.vendor_prices to authenticated;
grant select, insert, update, delete on public.shipments to authenticated;
grant select, insert, update, delete on public.shipment_photos to authenticated;
grant select, insert, update, delete on public.intake_groups to authenticated;

create policy "products active staff read" on public.products for select to authenticated using ((select private.is_active_factory_user()));
create policy "products active staff insert" on public.products for insert to authenticated with check ((select private.is_active_factory_user()));
create policy "products active staff update" on public.products for update to authenticated using ((select private.is_active_factory_user())) with check ((select private.is_active_factory_user()));
create policy "products admin delete" on public.products for delete to authenticated using ((select private.is_factory_admin()));

create policy "vendor prices active staff read" on public.vendor_prices for select to authenticated using ((select private.is_active_factory_user()));
create policy "vendor prices active staff insert" on public.vendor_prices for insert to authenticated with check ((select private.is_active_factory_user()));
create policy "vendor prices active staff update" on public.vendor_prices for update to authenticated using ((select private.is_active_factory_user())) with check ((select private.is_active_factory_user()));
create policy "vendor prices admin delete" on public.vendor_prices for delete to authenticated using ((select private.is_factory_admin()));

create policy "shipments active staff read" on public.shipments for select to authenticated using ((select private.is_active_factory_user()));
create policy "shipments active staff insert" on public.shipments for insert to authenticated with check ((select private.is_active_factory_user()));
create policy "shipments active staff update" on public.shipments for update to authenticated using ((select private.is_active_factory_user())) with check ((select private.is_active_factory_user()));
create policy "shipments admin delete" on public.shipments for delete to authenticated using ((select private.is_factory_admin()));

create policy "shipment photos active staff read" on public.shipment_photos for select to authenticated using ((select private.is_active_factory_user()));
create policy "shipment photos active staff insert" on public.shipment_photos for insert to authenticated with check ((select private.is_active_factory_user()));
create policy "shipment photos active staff update" on public.shipment_photos for update to authenticated using ((select private.is_active_factory_user())) with check ((select private.is_active_factory_user()));
create policy "shipment photos admin delete" on public.shipment_photos for delete to authenticated using ((select private.is_factory_admin()));

create policy "intake groups active staff read" on public.intake_groups for select to authenticated using ((select private.is_active_factory_user()));
create policy "intake groups active staff insert" on public.intake_groups for insert to authenticated with check ((select private.is_active_factory_user()));
create policy "intake groups active staff update" on public.intake_groups for update to authenticated using ((select private.is_active_factory_user())) with check ((select private.is_active_factory_user()));
create policy "intake groups admin delete" on public.intake_groups for delete to authenticated using ((select private.is_factory_admin()));


-- SOURCE tests/reference/main-migrations/20260917054455_secure_catalog_admin_and_product_photos.sql SHA256 fb1e58aedaeefb0381d3854af3cee414c63290d78099340fc3b976326cb4538b (verbatim)
-- Tighten product and price write permissions to admins only.
drop policy if exists "products active staff insert" on public.products;
drop policy if exists "products active staff update" on public.products;
drop policy if exists "vendor prices active staff insert" on public.vendor_prices;
drop policy if exists "vendor prices active staff update" on public.vendor_prices;

create policy "products admin insert"
on public.products for insert
to authenticated
with check (private.is_factory_admin());

create policy "products admin update"
on public.products for update
to authenticated
using (private.is_factory_admin())
with check (private.is_factory_admin());

create policy "vendor prices admin insert"
on public.vendor_prices for insert
to authenticated
with check (private.is_factory_admin());

create policy "vendor prices admin update"
on public.vendor_prices for update
to authenticated
using (private.is_factory_admin())
with check (private.is_factory_admin());

-- Keep the shared photo bucket private and cap uploads at 10 MB.
update storage.buckets
set public = false,
    file_size_limit = 10485760
where id = 'factory-photos';

-- Private photo access: active factory users may view; admins manage files.
drop policy if exists "factory photos active read" on storage.objects;
drop policy if exists "factory photos admin insert" on storage.objects;
drop policy if exists "factory photos admin update" on storage.objects;
drop policy if exists "factory photos admin delete" on storage.objects;

create policy "factory photos active read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_active_factory_user()
);

create policy "factory photos admin insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

create policy "factory photos admin update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
)
with check (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

create policy "factory photos admin delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

-- Maintain updated_at automatically for catalog records.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

drop trigger if exists vendor_prices_set_updated_at on public.vendor_prices;
create trigger vendor_prices_set_updated_at
before update on public.vendor_prices
for each row execute function private.set_updated_at();


-- SOURCE tests/reference/main-migrations/20260917110322_allow_staff_shipment_photo_uploads.sql SHA256 5b4146fd0dcbeb3e1c19e2f2a483aace825659190f6d9193fadcb85bb09fe691 (verbatim)
create policy "factory shipment photos active insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'factory-photos'
  and private.is_active_factory_user()
  and (storage.foldername(name))[1] = 'shipments'
);


-- SOURCE tests/reference/main-migrations/20260918065232_add_vendor_minimum_charge.sql SHA256 fdc148dacbc27577a0e81e7b1fd64e6b3dc2fa9302132d6cb9b09189b8526e9f (verbatim)
alter table public.vendor_prices
add column if not exists minimum_charge numeric null;

comment on column public.vendor_prices.minimum_charge is 'Minimum charge amount for this vendor/product price rule. Null means no minimum charge.';


-- SOURCE tests/reference/main-migrations/20260918065939_add_shipment_void_fields.sql SHA256 d12ec75aefcc7742f7ffb15d9a44da26e994431dff8ab99a6de525876ae37ff8 (verbatim)

alter table public.shipments
  add column if not exists voided_at timestamptz null,
  add column if not exists void_reason text null,
  add column if not exists voided_by uuid null references auth.users(id) on delete set null;

create index if not exists shipments_demo_voided_at_idx
  on public.shipments (is_demo, voided_at);


-- SOURCE tests/reference/main-migrations/20260918070559_add_shipment_price_snapshots.sql SHA256 58ccf020575fbfa033e25426e02785cca732e9151bf53badea2a44404f0febe2 (verbatim)

alter table public.shipments
  add column if not exists unit_price_snapshot numeric null,
  add column if not exists unit_snapshot text null,
  add column if not exists minimum_charge_snapshot numeric null,
  add column if not exists calculated_amount_snapshot numeric null;

comment on column public.shipments.unit_price_snapshot is 'Vendor unit price captured when shipment is marked shipped.';
comment on column public.shipments.unit_snapshot is 'Pricing unit captured when shipment is marked shipped.';
comment on column public.shipments.minimum_charge_snapshot is 'Minimum charge captured when shipment is marked shipped.';
comment on column public.shipments.calculated_amount_snapshot is 'Calculated amount captured when shipment is marked shipped.';


-- SOURCE tests/reference/main-migrations/20260918074939_create_vendors_and_sites.sql SHA256 9375148043e2d84b271c789724d7b1fb4f9012519f54fd4d5d77d98856a4d5fd (verbatim)

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


-- SOURCE tests/reference/main-migrations/20260918101353_link_vendors_to_prices_and_shipments.sql SHA256 ada584fe86089269409fe487e6aa91d60228517ee73f83531f5e9a3a8e077e4e (verbatim)

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


-- SOURCE tests/reference/main-migrations/20260920081130_add_vendor_price_history.sql SHA256 5173682dc7e72c2b2681c4cdb1073b11d61bcca69e845526e968dcfddc4afdf9 (verbatim)

alter table public.vendor_prices
  add column if not exists end_date date;

alter table public.vendor_prices
  drop constraint if exists vendor_prices_date_range_check;

alter table public.vendor_prices
  add constraint vendor_prices_date_range_check
  check (end_date is null or effective_date is null or end_date >= effective_date);

alter table public.vendor_prices
  drop constraint if exists vendor_prices_unit_price_nonnegative;

alter table public.vendor_prices
  add constraint vendor_prices_unit_price_nonnegative
  check (unit_price >= 0);

alter table public.vendor_prices
  drop constraint if exists vendor_prices_minimum_charge_nonnegative;

alter table public.vendor_prices
  add constraint vendor_prices_minimum_charge_nonnegative
  check (minimum_charge is null or minimum_charge >= 0);

create index if not exists vendor_prices_history_lookup_idx
  on public.vendor_prices (vendor_id, vendor_name, product_id, effective_date desc, end_date);

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
security definer
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


-- SOURCE tests/reference/main-migrations/20260920081452_secure_vendor_price_history_rpc.sql SHA256 b7bcffe5b86d99988ab2ca32edfd51d16e8ae001b98978c0ac354ac949752a9e (verbatim)

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


-- SOURCE tests/cloud/observed_dispatch_locations.sql SHA256 5857d82506716db64111dd2c9235b0707c7c9968d55b3baf34f8c8c44c9ffd21 (observed-ddl)
create table public.dispatch_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  contact_name text,
  phone text,
  fax text,
  address text not null check (length(btrim(address)) > 0),
  note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dispatch_locations enable row level security;
revoke all on public.dispatch_locations from anon, authenticated;
grant select, insert, update on public.dispatch_locations to authenticated;

create policy "dispatch locations active staff read"
on public.dispatch_locations for select to authenticated
using ((select private.is_active_factory_user()) and (is_active = true or (select private.is_factory_admin())));

create policy "dispatch locations admin insert"
on public.dispatch_locations for insert to authenticated
with check ((select private.is_factory_admin()));

create policy "dispatch locations admin update"
on public.dispatch_locations for update to authenticated
using ((select private.is_factory_admin()))
with check ((select private.is_factory_admin()));


-- SOURCE tests/cloud/observed_shipments_voided_by_index.sql SHA256 546b7d7f35bfce746bf9017a1625f1a44e587e35c5868778895562a2d7e65a34 (observed-ddl)
create index shipments_voided_by_idx on public.shipments (voided_by);

commit;
