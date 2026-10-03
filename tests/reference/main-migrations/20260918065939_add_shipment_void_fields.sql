
alter table public.shipments
  add column if not exists voided_at timestamptz null,
  add column if not exists void_reason text null,
  add column if not exists voided_by uuid null references auth.users(id) on delete set null;

create index if not exists shipments_demo_voided_at_idx
  on public.shipments (is_demo, voided_at);
