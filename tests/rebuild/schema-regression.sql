do $verify$
declare n integer;
begin
  select count(*) into n from pg_tables where schemaname='public';
  if n <> 10 then raise exception 'Expected 10 business tables, found %',n; end if;
  if exists (select 1 from pg_class c join pg_namespace s on s.oid=c.relnamespace
    where s.nspname='public' and c.relkind='r' and not c.relrowsecurity) then
    raise exception 'A business table lacks RLS';
  end if;
  select count(*) into n from information_schema.columns where table_schema='public' and table_name='dispatch_locations';
  if n <> 11 then raise exception 'Dispatch table column drift: %',n; end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and tablename='shipments'
    and indexname='shipments_voided_by_idx' and indexdef='CREATE INDEX shipments_voided_by_idx ON public.shipments USING btree (voided_by)') then
    raise exception 'Missing or incorrect voided_by index';
  end if;
  select count(*) into n from pg_policies where schemaname='public' and tablename='dispatch_locations';
  if n <> 3 then raise exception 'Dispatch policy drift'; end if;
  if not has_table_privilege('authenticated','public.dispatch_locations','SELECT')
    or not has_table_privilege('authenticated','public.dispatch_locations','INSERT')
    or not has_table_privilege('authenticated','public.dispatch_locations','UPDATE')
    or has_table_privilege('authenticated','public.dispatch_locations','DELETE')
    or has_table_privilege('anon','public.dispatch_locations','SELECT') then
    raise exception 'Dispatch grants drift';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and 'anon'=any(roles)) then
    raise exception 'Historical anonymous catalog policy was replayed';
  end if;
  if to_regclass('public.backup_snapshots') is not null or to_regnamespace('cron') is not null then
    raise exception 'Excluded backup/scheduler was installed';
  end if;
  if not exists (select 1 from storage.buckets where id='factory-photos' and public=false and file_size_limit=10485760) then
    raise exception 'Private bucket definition drift';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('replace_vendor_price','create_shipment_atomic','create_shipment_idempotent',
    'update_shipment_with_group','create_product_with_initial_price','create_product_with_initial_price_idempotent',
    'delete_shipment_with_cleanup_job','record_shipment_cleanup_result') and p.prosecdef) then
    raise exception 'Business RPC unexpectedly bypasses RLS';
  end if;
  if has_function_privilege('authenticated','public.create_shipment_atomic(jsonb,text,date)','EXECUTE')
    or has_function_privilege('anon','public.create_product_with_initial_price(text,text,text,text,text,uuid,numeric,numeric,text,date)','EXECUTE')
    or not has_function_privilege('service_role','public.create_shipment_atomic(jsonb,text,date)','EXECUTE') then
    raise exception 'RPC execute privileges drift';
  end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid=p.pronamespace
    where s.nspname='public' and p.proname in ('replace_vendor_price','create_shipment_atomic','create_shipment_idempotent',
    'update_shipment_with_group','create_product_with_initial_price','create_product_with_initial_price_idempotent',
    'delete_shipment_with_cleanup_job','record_shipment_cleanup_result');
  if n <> 8 then raise exception 'Missing/overloaded business RPC: %',n; end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'Missing qualified digest dependency';
  end if;
  if has_table_privilege('authenticated','private.shipment_deletion_jobs','SELECT') then
    raise exception 'Private deletion jobs exposed';
  end if;
end
$verify$;
