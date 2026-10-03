-- Test-project-only trial. This is not an approved main-environment migration.
do $guard$
begin
  perform 1 from test_guard.project_identity
  where project_ref = 'zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'Unsafe project for shipment deletion trial'; end if;
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test') then
    raise exception 'Test photo bucket is missing';
  end if;
end
$guard$;

create table if not exists private.shipment_deletion_jobs (
  shipment_id uuid primary key,
  storage_paths text[] not null default '{}',
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  cleanup_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on private.shipment_deletion_jobs from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update on private.shipment_deletion_jobs to service_role;

create or replace function public.delete_shipment_with_cleanup_job(p_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_shipment public.shipments%rowtype;
  v_job private.shipment_deletion_jobs%rowtype;
  v_paths text[];
begin
  select * into v_job
  from private.shipment_deletion_jobs
  where shipment_id = p_id;
  if found then
    return jsonb_build_object(
      'id', v_job.shipment_id,
      'storage_paths', to_jsonb(v_job.storage_paths),
      'cleanup_completed', v_job.cleanup_completed_at is not null,
      'replayed', true
    );
  end if;

  select * into v_shipment
  from public.shipments
  where id = p_id and is_demo = false
  for update;

  if not found then
    -- A concurrent deletion may have committed while this call waited on the row.
    select * into v_job
    from private.shipment_deletion_jobs
    where shipment_id = p_id;
    if found then
      return jsonb_build_object(
        'id', v_job.shipment_id,
        'storage_paths', to_jsonb(v_job.storage_paths),
        'cleanup_completed', v_job.cleanup_completed_at is not null,
        'replayed', true
      );
    end if;
    raise exception 'shipment not found' using errcode = 'P0002';
  end if;
  if v_shipment.voided_at is null then
    raise exception 'void shipment before permanent delete' using errcode = '23514';
  end if;

  select coalesce(array_agg(storage_path order by created_at), '{}')
  into v_paths
  from public.shipment_photos
  where shipment_id = p_id;

  insert into private.shipment_deletion_jobs (shipment_id, storage_paths)
  values (p_id, v_paths)
  returning * into v_job;

  -- The job and relational deletion commit or roll back in the same transaction.
  -- shipment_photos are removed by their existing ON DELETE CASCADE foreign key.
  delete from public.shipments where id = p_id and is_demo = false;
  if not found then raise exception 'shipment delete lost its target'; end if;

  return jsonb_build_object(
    'id', v_job.shipment_id,
    'storage_paths', to_jsonb(v_job.storage_paths),
    'cleanup_completed', false,
    'replayed', false
  );
end
$function$;

create or replace function public.record_shipment_cleanup_result(p_id uuid, p_error text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job private.shipment_deletion_jobs%rowtype;
begin
  update private.shipment_deletion_jobs
  set attempts = attempts + 1,
      last_error = nullif(btrim(p_error), ''),
      cleanup_completed_at = case
        when nullif(btrim(p_error), '') is null then coalesce(cleanup_completed_at, now())
        else cleanup_completed_at
      end,
      updated_at = now()
  where shipment_id = p_id
  returning * into v_job;
  if not found then raise exception 'shipment cleanup job not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'id', v_job.shipment_id,
    'attempts', v_job.attempts,
    'cleanup_completed', v_job.cleanup_completed_at is not null,
    'last_error', v_job.last_error
  );
end
$function$;

revoke all on function public.delete_shipment_with_cleanup_job(uuid) from public, anon, authenticated;
revoke all on function public.record_shipment_cleanup_result(uuid, text) from public, anon, authenticated;
grant execute on function public.delete_shipment_with_cleanup_job(uuid) to service_role;
grant execute on function public.record_shipment_cleanup_result(uuid, text) to service_role;
