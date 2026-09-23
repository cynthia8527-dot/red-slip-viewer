do $test$
declare
  expected_project constant text := 'zfcsuxihpakrsohvcwlr';
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_vendor_name text;
  v_group_label text;
  v_created jsonb;
  v_updated jsonb;
  v_shipment_id uuid;
  v_group_id uuid;
begin
  perform 1 from test_guard.project_identity where project_ref = expected_project;
  if not found then raise exception 'T029 unsafe project'; end if;

  v_vendor_name := 'CODEX_T029_' || v_suffix;
  v_group_label := 'CODEX_T029_GROUP_' || v_suffix;

  -- Simulate an older caller that knows neither idempotency column.
  v_created := public.create_shipment_atomic(
    jsonb_build_object(
      'vendor_name', v_vendor_name,
      'item_name', 'Legacy-compatible shipment',
      'location', '蘆洲',
      'status', '未開始',
      'urgent', false,
      'cannot_mix', false,
      'is_demo', false
    ),
    v_group_label,
    current_date
  );
  v_shipment_id := (v_created ->> 'id')::uuid;

  select intake_group_id into v_group_id
  from public.shipments
  where id = v_shipment_id;
  if not found or v_group_id is null then
    raise exception 'T029 legacy create did not persist a readable grouped shipment';
  end if;
  if exists (
    select 1 from public.shipments
    where id = v_shipment_id
      and (create_request_id is not null or create_request_fingerprint is not null)
  ) then
    raise exception 'T029 legacy create unexpectedly populated idempotency columns';
  end if;

  -- The pre-idempotency update RPC must still accept and return the old row.
  v_updated := public.update_shipment_with_group(
    v_shipment_id,
    jsonb_build_object('note', 'Legacy update remains compatible'),
    v_group_id,
    null,
    current_date
  );
  if (v_updated ->> 'id')::uuid is distinct from v_shipment_id then
    raise exception 'T029 legacy update returned a different shipment';
  end if;
  if not exists (
    select 1 from public.shipments
    where id = v_shipment_id
      and intake_group_id = v_group_id
      and note = 'Legacy update remains compatible'
      and create_request_id is null
      and create_request_fingerprint is null
  ) then
    raise exception 'T029 legacy row was not readable or was changed incompatibly';
  end if;

  delete from public.shipments where id = v_shipment_id;
  delete from public.intake_groups where id = v_group_id;
  raise notice 'T029 PASS';
end
$test$;
