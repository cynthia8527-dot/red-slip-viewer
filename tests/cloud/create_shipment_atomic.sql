-- Test-project-only trial. This is not an approved main-environment migration.
do $guard$
begin
  perform 1 from test_guard.project_identity
  where project_ref = 'zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'Unsafe project for atomic shipment trial'; end if;
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test') then
    raise exception 'Test photo bucket is missing';
  end if;
end
$guard$;

create or replace function public.create_shipment_atomic(
  p_shipment jsonb,
  p_group_label text,
  p_received_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_row public.shipments%rowtype;
  v_saved public.shipments%rowtype;
  v_group_id uuid;
  v_group jsonb;
begin
  select * into v_row from jsonb_populate_record(null::public.shipments, p_shipment);
  if nullif(btrim(v_row.vendor_name), '') is null or nullif(btrim(v_row.item_name), '') is null then
    raise exception 'vendor_name and item_name are required';
  end if;
  if v_row.is_demo is distinct from false then
    raise exception 'Only non-demo shipments are allowed';
  end if;

  v_group_id := v_row.intake_group_id;
  if v_group_id is null and nullif(btrim(p_group_label), '') is not null then
    select id into v_group_id from public.intake_groups
    where is_demo = false and vendor_name = v_row.vendor_name
      and received_date = coalesce(p_received_date, current_date)
      and label = btrim(p_group_label)
    limit 1;
    if v_group_id is null then
      insert into public.intake_groups (vendor_name, received_date, label, is_demo)
      values (v_row.vendor_name, coalesce(p_received_date, current_date), btrim(p_group_label), false)
      returning id into v_group_id;
    end if;
  end if;

  insert into public.shipments (
    vendor_name, vendor_id, item_name, product_id, material, process, boxes,
    weight_kg, weigh_at, location, status, due_date, urgent, note, shipped_at,
    intake_group_id, batch_label, cannot_mix, is_demo, unit_price_snapshot,
    unit_snapshot, minimum_charge_snapshot, calculated_amount_snapshot
  ) values (
    v_row.vendor_name, v_row.vendor_id, v_row.item_name, v_row.product_id,
    v_row.material, v_row.process, v_row.boxes, v_row.weight_kg, v_row.weigh_at,
    v_row.location, v_row.status, v_row.due_date, v_row.urgent, v_row.note,
    v_row.shipped_at, v_group_id, v_row.batch_label, v_row.cannot_mix, false,
    v_row.unit_price_snapshot, v_row.unit_snapshot, v_row.minimum_charge_snapshot,
    v_row.calculated_amount_snapshot
  ) returning * into v_saved;

  if v_group_id is not null then
    select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
      into v_group from public.intake_groups where id = v_group_id;
  end if;
  return to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group);
end
$function$;

revoke all on function public.create_shipment_atomic(jsonb, text, date) from public, anon, authenticated;
grant execute on function public.create_shipment_atomic(jsonb, text, date) to service_role;
