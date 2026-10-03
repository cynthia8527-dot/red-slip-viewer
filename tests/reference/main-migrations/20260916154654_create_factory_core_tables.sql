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
