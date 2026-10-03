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
