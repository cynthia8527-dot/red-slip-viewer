alter table public.shipments add column if not exists is_demo boolean not null default false;
create index if not exists shipments_is_demo_idx on public.shipments(is_demo);
