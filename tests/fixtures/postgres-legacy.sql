-- Synthetic PostgreSQL fixture, not a complete Supabase/production baseline.
create role anon;
create role authenticated;
create role service_role;
create schema test_guard;
create table test_guard.project_identity(project_ref text);
insert into test_guard.project_identity values ('zfcsuxihpakrsohvcwlr');
create schema storage;
create table storage.buckets(id text);
insert into storage.buckets values ('factory-photos-test');

create table public.products(id uuid primary key default gen_random_uuid(), name text not null);
create table public.intake_groups(
  id uuid primary key default gen_random_uuid(), vendor_name text not null,
  received_date date, label text, is_demo boolean not null default false
);
create table public.shipments(
  id uuid primary key default gen_random_uuid(), vendor_name text not null, item_name text not null,
  vendor_id uuid, product_id uuid, material text, process text, boxes text,
  weight_kg numeric, weigh_at timestamptz, location text, status text, due_date date,
  urgent boolean, note text, shipped_at timestamptz,
  intake_group_id uuid references public.intake_groups(id), batch_label text,
  cannot_mix boolean, is_demo boolean not null default false,
  unit_price_snapshot numeric, unit_snapshot text, minimum_charge_snapshot numeric,
  calculated_amount_snapshot numeric
);
