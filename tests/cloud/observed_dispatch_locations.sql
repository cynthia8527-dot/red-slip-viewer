-- Test-project reconstruction of the current dispatch_locations structure.
-- This table is missing from the recovered main-project migration history.
-- Do not apply to the main project without first resolving migration provenance.
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
