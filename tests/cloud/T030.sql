do $test$
declare
  expected_project constant text := 'zfcsuxihpakrsohvcwlr';
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_ok_id uuid;
  v_fail_id uuid;
  v_result jsonb;
begin
  perform 1 from test_guard.project_identity where project_ref = expected_project;
  if not found then raise exception 'T030 unsafe project'; end if;

  insert into public.shipments (
    vendor_name, item_name, location, status, urgent, is_demo, voided_at
  ) values (
    'CODEX_T030_' || v_suffix, 'deletion succeeds', '蘆洲', '未開始', false, false, now()
  ) returning id into v_ok_id;
  insert into public.shipment_photos (shipment_id, storage_path)
  values (v_ok_id, 'shipments/' || v_ok_id || '/one.jpg');

  v_result := public.delete_shipment_with_cleanup_job(v_ok_id);
  if (v_result ->> 'replayed')::boolean or (v_result ->> 'cleanup_completed')::boolean then
    raise exception 'T030 first deletion returned an invalid state';
  end if;
  if coalesce(jsonb_array_length(v_result -> 'storage_paths'), 0) <> 1 then
    raise exception 'T030 cleanup job did not retain its photo path';
  end if;
  if exists (select 1 from public.shipments where id = v_ok_id)
     or exists (select 1 from public.shipment_photos where shipment_id = v_ok_id) then
    raise exception 'T030 relational deletion did not commit atomically';
  end if;

  v_result := public.delete_shipment_with_cleanup_job(v_ok_id);
  if not (v_result ->> 'replayed')::boolean then
    raise exception 'T030 retry did not return the durable deletion job';
  end if;
  perform public.record_shipment_cleanup_result(v_ok_id, 'forced Storage failure');
  if not exists (
    select 1 from private.shipment_deletion_jobs
    where shipment_id = v_ok_id and attempts = 1
      and cleanup_completed_at is null and last_error = 'forced Storage failure'
  ) then
    raise exception 'T030 failed cleanup was not retained for retry';
  end if;
  perform public.record_shipment_cleanup_result(v_ok_id, null);
  if not exists (
    select 1 from private.shipment_deletion_jobs
    where shipment_id = v_ok_id and attempts = 2
      and cleanup_completed_at is not null and last_error is null
  ) then
    raise exception 'T030 successful retry was not marked complete';
  end if;

  insert into public.shipments (
    vendor_name, item_name, location, status, urgent, is_demo, voided_at
  ) values (
    'CODEX_T030_FAIL_' || v_suffix, 'deletion rolls back', '蘆洲', '未開始', false, false, now()
  ) returning id into v_fail_id;
  insert into public.shipment_photos (shipment_id, storage_path)
  values (v_fail_id, 'shipments/' || v_fail_id || '/rollback.jpg');

  create temporary table t030_delete_guard (shipment_id uuid primary key) on commit drop;
  insert into t030_delete_guard values (v_fail_id);
  create or replace function pg_temp.t030_reject_delete()
  returns trigger language plpgsql as $trigger$
  begin
    if exists (select 1 from t030_delete_guard where shipment_id = old.id) then
      raise exception 'T030 forced relational delete failure';
    end if;
    return old;
  end
  $trigger$;
  create trigger t030_reject_delete
    before delete on public.shipments
    for each row execute function pg_temp.t030_reject_delete();

  begin
    perform public.delete_shipment_with_cleanup_job(v_fail_id);
    raise exception 'T030 expected forced delete failure';
  exception when others then
    if sqlerrm = 'T030 expected forced delete failure' then raise; end if;
  end;

  if not exists (select 1 from public.shipments where id = v_fail_id)
     or not exists (select 1 from public.shipment_photos where shipment_id = v_fail_id) then
    raise exception 'T030 failed relational delete left partial data';
  end if;
  if exists (select 1 from private.shipment_deletion_jobs where shipment_id = v_fail_id) then
    raise exception 'T030 failed relational delete left a cleanup job';
  end if;

  drop trigger t030_reject_delete on public.shipments;
  delete from public.shipments where id = v_fail_id;
  delete from private.shipment_deletion_jobs where shipment_id = v_ok_id;
  raise notice 'T030 PASS';
end
$test$;
