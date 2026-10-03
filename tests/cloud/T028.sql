do $test$
declare
  expected_project constant text := 'zfcsuxihpakrsohvcwlr';
  request_id uuid := gen_random_uuid();
  fingerprint text := repeat('a', 64);
  v_vendor_name text := 'CODEX_T028_' || replace(request_id::text, '-', '');
  v_group_label text := 'CODEX_T028_GROUP_' || replace(request_id::text, '-', '');
  first_result jsonb;
  retry_result jsonb;
  first_id uuid;
  mismatch_rejected boolean := false;
  invalid_fingerprint text;
begin
  perform 1 from test_guard.project_identity where project_ref = expected_project;
  if not found then raise exception 'T028 unsafe project'; end if;

  foreach invalid_fingerprint in array array[null::text, '', repeat('a', 63), repeat('G', 64)] loop
    begin
      perform public.create_shipment_idempotent(
        jsonb_build_object('vendor_name', v_vendor_name, 'item_name', 'Invalid fingerprint',
          'location', '蘆洲', 'status', '未開始', 'urgent', false, 'cannot_mix', false, 'is_demo', false),
        v_group_label, current_date, gen_random_uuid(), invalid_fingerprint
      );
      raise exception 'T028 invalid fingerprint was accepted: %', coalesce(invalid_fingerprint, 'NULL');
    exception when sqlstate '22023' then null;
    end;
  end loop;
  if exists (select 1 from public.shipments where vendor_name = v_vendor_name)
      or exists (select 1 from public.intake_groups where vendor_name = v_vendor_name) then
    raise exception 'T028 rejected request left partial data';
  end if;

  first_result := public.create_shipment_idempotent(
    jsonb_build_object(
      'vendor_name', v_vendor_name,
      'item_name', 'Idempotent shipment',
      'location', '蘆洲',
      'status', '未開始',
      'urgent', false,
      'cannot_mix', false,
      'is_demo', false
    ),
    v_group_label,
    current_date,
    request_id,
    fingerprint
  );
  retry_result := public.create_shipment_idempotent(
    jsonb_build_object(
      'vendor_name', v_vendor_name,
      'item_name', 'Idempotent shipment',
      'location', '蘆洲',
      'status', '未開始',
      'urgent', false,
      'cannot_mix', false,
      'is_demo', false
    ),
    v_group_label,
    current_date,
    request_id,
    fingerprint
  );

  first_id := (first_result #>> '{shipment,id}')::uuid;
  begin
    update public.shipments set create_request_fingerprint = null where id = first_id;
    raise exception 'T028 request ID without fingerprint was accepted';
  exception when check_violation then null;
  end;
  if coalesce((first_result ->> 'replayed')::boolean, true) then
    raise exception 'T028 first request was incorrectly marked as replayed';
  end if;
  if not coalesce((retry_result ->> 'replayed')::boolean, false) then
    raise exception 'T028 retry was not marked as replayed';
  end if;
  if (retry_result #>> '{shipment,id}')::uuid is distinct from first_id then
    raise exception 'T028 retry returned a different shipment';
  end if;
  if (select count(*) from public.shipments where create_request_id = request_id) <> 1 then
    raise exception 'T028 duplicate shipment was created';
  end if;
  if (select count(*) from public.intake_groups where vendor_name = v_vendor_name and label = v_group_label) <> 1 then
    raise exception 'T028 duplicate intake group was created';
  end if;

  begin
    perform public.create_shipment_idempotent(
      jsonb_build_object(
        'vendor_name', v_vendor_name,
        'item_name', 'Changed shipment',
        'location', '蘆洲',
        'status', '未開始',
        'urgent', false,
        'cannot_mix', false,
        'is_demo', false
      ),
      v_group_label,
      current_date,
      request_id,
      repeat('b', 64)
    );
  exception when sqlstate '22023' then
    mismatch_rejected := true;
  end;
  if not mismatch_rejected then
    raise exception 'T028 reused key with changed content was accepted';
  end if;

  delete from public.shipments where id = first_id;
  delete from public.intake_groups where vendor_name = v_vendor_name and label = v_group_label;
  raise notice 'T028 PASS';
end
$test$;
