-- TEST FIXTURE ONLY: observed 2026-10-02 metadata. Never apply to production.

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

CREATE OR REPLACE FUNCTION private.capture_factory_text_backup(p_kind text DEFAULT 'daily'::text, p_period_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'profiles', (select count(*) from public.profiles),
    'allowed_emails', (select count(*) from public.allowed_emails),
    'vendors', (select count(*) from public.vendors),
    'vendor_sites', (select count(*) from public.vendor_sites),
    'products', (select count(*) from public.products),
    'vendor_prices', (select count(*) from public.vendor_prices),
    'intake_groups', (select count(*) from public.intake_groups),
    'shipments', (select count(*) from public.shipments),
    'shipment_photos', (select count(*) from public.shipment_photos),
    'dispatch_locations', (select count(*) from public.dispatch_locations)
  );

  v_payload := jsonb_build_object(
    'backup_version', 3,
    'created_at', now(),
    'timezone', 'Asia/Taipei',
    'profiles', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.profiles x), '[]'::jsonb),
    'allowed_emails', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.allowed_emails x), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendors x), '[]'::jsonb),
    'vendor_sites', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendor_sites x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.products x), '[]'::jsonb),
    'vendor_prices', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.vendor_prices x), '[]'::jsonb),
    'intake_groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.intake_groups x), '[]'::jsonb),
    'shipments', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.shipments x), '[]'::jsonb),
    'shipment_photos', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.shipment_photos x), '[]'::jsonb),
    'dispatch_locations', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order, x.created_at) from public.dispatch_locations x), '[]'::jsonb)
  );

  insert into public.backup_snapshots(kind, period_key, row_counts, payload)
  values (p_kind, v_key, v_counts, v_payload)
  returning id into v_id;

  return v_id;
end;
$function$;

REVOKE ALL ON FUNCTION private.capture_factory_text_backup(text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.compact_factory_text_backups()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION private.compact_factory_text_backups() FROM PUBLIC, anon, authenticated, service_role;


-- Observed schema-only differences; no production rows, accounts or secrets.
CREATE TRIGGER set_dispatch_locations_updated_at BEFORE UPDATE ON public.dispatch_locations FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
GRANT EXECUTE ON FUNCTION public.replace_vendor_price(uuid,numeric,numeric,text,text,date,text) TO service_role;
GRANT ALL ON public.backup_snapshots TO service_role;
SELECT cron.schedule('factory-text-backup-daily','10 19 * * *',$$select private.capture_factory_text_backup('daily', null);$$);
SELECT cron.schedule('factory-text-backup-monthly-compact','40 19 1 * *',$$select private.compact_factory_text_backups();$$);
