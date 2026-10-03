import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const projectId = 'zfcsuxihpakrsohvcwlr';
const migration = readFileSync(new URL('../reference/main-migrations/20260920081130_add_vendor_price_history.sql', import.meta.url), 'utf8');
const expectedSha256 = '5173682dc7e72c2b2681c4cdb1073b11d61bcca69e845526e968dcfddc4afdf9';

// Only the original table DDL can run in this transaction-local rehearsal.
// The later public function/GRANT statements need a full baseline migration rehearsal.
export function buildPriceHistoryRehearsalSql(targetProjectId) {
  if (targetProjectId !== projectId) throw new Error('Price rehearsal requires the dedicated test project');
  if (createHash('sha256').update(migration).digest('hex') !== expectedSha256) {
    throw new Error('Historical price migration changed; review before rehearsal');
  }
  const marker = 'create or replace function public.replace_vendor_price(';
  if (migration.split(marker).length !== 2) throw new Error('Cannot isolate historical table DDL');
  const [tableDdl] = migration.split(marker);
  if ((tableDdl.match(/public\.vendor_prices/g) || []).length !== 8 ||
      /\b(begin|commit|rollback|drop table|delete from|truncate)\b/i.test(tableDdl)) {
    throw new Error('Unexpected historical table DDL; manual review required');
  }
  const isolatedDdl = tableDdl
    .replaceAll('public.vendor_prices', 'pg_temp.t019_vendor_prices')
    .replaceAll('vendor_prices_history_lookup_idx', 't019_vendor_prices_history_lookup_idx');
  return `begin;
do $guard$
begin
  perform 1 from test_guard.project_identity where project_ref = '${projectId}';
  if not found or not exists (select 1 from storage.buckets where id = 'factory-photos-test')
      or exists (select 1 from storage.buckets where id = 'factory-photos') then
    raise exception 'T019 price rehearsal requires the dedicated test project';
  end if;
end $guard$;

create temporary table t019_vendor_prices (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  vendor_id uuid,
  product_id uuid,
  process_name text,
  unit text not null default 'kg',
  unit_price numeric(12,2) not null,
  minimum_charge numeric,
  effective_date date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
) on commit drop;
insert into pg_temp.t019_vendor_prices (vendor_name, unit_price, effective_date)
values ('CODEX_T019_OLD_PRICE', 70, date '2026-01-01');

${isolatedDdl}

do $verify$
declare
  v_price_id uuid;
begin
  select id into v_price_id from pg_temp.t019_vendor_prices where vendor_name = 'CODEX_T019_OLD_PRICE';
  if v_price_id is null or not exists (
    select 1 from pg_temp.t019_vendor_prices where id = v_price_id
      and unit_price = 70 and end_date is null and effective_date = date '2026-01-01'
  ) then raise exception 'T019 old price was lost or altered by table DDL'; end if;
  if not exists (
    select 1 from pg_indexes where schemaname = pg_my_temp_schema()::regnamespace::text
      and indexname = 't019_vendor_prices_history_lookup_idx'
  ) then raise exception 'T019 history index missing on isolated table'; end if;

  begin
    update pg_temp.t019_vendor_prices set end_date = date '2025-12-31' where id = v_price_id;
    raise exception 'T019 date-range constraint was not enforced';
  exception when check_violation then null; end;
  begin
    update pg_temp.t019_vendor_prices set unit_price = -1 where id = v_price_id;
    raise exception 'T019 nonnegative price constraint was not enforced';
  exception when check_violation then null; end;
  begin
    update pg_temp.t019_vendor_prices set minimum_charge = -1 where id = v_price_id;
    raise exception 'T019 nonnegative minimum constraint was not enforced';
  exception when check_violation then null; end;
  if not exists (
    select 1 from pg_temp.t019_vendor_prices where id = v_price_id
      and unit_price = 70 and end_date is null and minimum_charge is null
  ) then raise exception 'T019 old price changed during constraint checks'; end if;
  raise notice 'T019 PRICE DDL REHEARSAL PASS';
end $verify$;
rollback;`;
}
