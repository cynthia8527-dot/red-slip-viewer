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
