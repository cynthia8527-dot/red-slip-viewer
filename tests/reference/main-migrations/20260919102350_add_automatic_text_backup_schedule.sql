
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily','monthly','manual')),
  period_key text,
  created_at timestamptz not null default now(),
  row_counts jsonb not null default '{}'::jsonb,
  payload jsonb not null
);

create unique index if not exists backup_snapshots_kind_period_key_uidx
  on public.backup_snapshots(kind, period_key)
  where period_key is not null;

create index if not exists backup_snapshots_created_at_idx
  on public.backup_snapshots(created_at desc);

alter table public.backup_snapshots enable row level security;

revoke all on public.backup_snapshots from anon;
revoke insert, update, delete on public.backup_snapshots from authenticated;
grant select on public.backup_snapshots to authenticated;

drop policy if exists "backup snapshots admin read" on public.backup_snapshots;
create policy "backup snapshots admin read"
on public.backup_snapshots
for select
to authenticated
using ((select private.is_factory_admin()));

create or replace function private.capture_factory_text_backup(
  p_kind text default 'daily',
  p_period_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_existing uuid;
  v_id uuid;
  v_payload jsonb;
  v_counts jsonb;
begin
  if p_kind not in ('daily','monthly','manual') then
    raise exception 'invalid backup kind';
  end if;

  if p_period_key is not null then
    v_key := p_period_key;
  elsif p_kind = 'daily' then
    v_key := to_char((now() at time zone 'Asia/Taipei')::date, 'YYYY-MM-DD');
  elsif p_kind = 'monthly' then
    v_key := to_char((date_trunc('month', now() at time zone 'Asia/Taipei') - interval '1 month')::date, 'YYYY-MM');
  else
    v_key := null;
  end if;

  if v_key is not null then
    select b.id into v_existing
    from public.backup_snapshots b
    where b.kind = p_kind and b.period_key = v_key
    limit 1;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  v_counts := jsonb_build_object(
    'vendors', (select count(*) from public.vendors),
    'vendor_sites', (select count(*) from public.vendor_sites),
    'products', (select count(*) from public.products),
    'vendor_prices', (select count(*) from public.vendor_prices),
    'intake_groups', (select count(*) from public.intake_groups),
    'shipments', (select count(*) from public.shipments),
    'shipment_photos', (select count(*) from public.shipment_photos)
  );

  v_payload := jsonb_build_object(
    'backup_version', 1,
    'created_at', now(),
    'timezone', 'Asia/Taipei',
    'vendors', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendors x), '[]'::jsonb),
    'vendor_sites', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendor_sites x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.products x), '[]'::jsonb),
    'vendor_prices', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendor_prices x), '[]'::jsonb),
    'intake_groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.intake_groups x), '[]'::jsonb),
    'shipments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.shipments x), '[]'::jsonb),
    'shipment_photos', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.shipment_photos x), '[]'::jsonb)
  );

  insert into public.backup_snapshots(kind, period_key, row_counts, payload)
  values (p_kind, v_key, v_counts, v_payload)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function private.capture_factory_text_backup(text,text) from public, anon, authenticated;

create or replace function private.compact_factory_text_backups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_month_start date;
  v_this_month_start date;
  v_month_key text;
  v_source public.backup_snapshots%rowtype;
begin
  v_this_month_start := date_trunc('month', now() at time zone 'Asia/Taipei')::date;
  v_prev_month_start := (v_this_month_start - interval '1 month')::date;
  v_month_key := to_char(v_prev_month_start, 'YYYY-MM');

  if not exists (
    select 1 from public.backup_snapshots
    where kind='monthly' and period_key=v_month_key
  ) then
    select * into v_source
    from public.backup_snapshots
    where kind='daily'
      and period_key >= to_char(v_prev_month_start, 'YYYY-MM-DD')
      and period_key < to_char(v_this_month_start, 'YYYY-MM-DD')
    order by period_key desc, created_at desc
    limit 1;

    if v_source.id is not null then
      insert into public.backup_snapshots(kind, period_key, row_counts, payload)
      values ('monthly', v_month_key, v_source.row_counts, v_source.payload)
      on conflict do nothing;
    end if;
  end if;

  delete from public.backup_snapshots
  where kind='daily'
    and created_at < now() - interval '30 days';

  delete from cron.job_run_details
  where end_time < now() - interval '30 days';
end;
$$;

revoke all on function private.compact_factory_text_backups() from public, anon, authenticated;

select cron.schedule(
  'factory-text-backup-daily',
  '10 19 * * *',
  $$select private.capture_factory_text_backup('daily', null);$$
);

select cron.schedule(
  'factory-text-backup-monthly-compact',
  '40 19 1 * *',
  $$select private.compact_factory_text_backups();$$
);
