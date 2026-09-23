-- Test-project-only trial, not an approved main-environment migration.
do $guard$
begin
  perform 1 from test_guard.project_identity
  where project_ref = 'zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'Unsafe project for grouped shipment update trial'; end if;
  if not exists (select 1 from storage.buckets where id = 'factory-photos-test') then
    raise exception 'Test photo bucket is missing';
  end if;
end
$guard$;

create or replace function public.update_shipment_with_group(
  p_id uuid,
  p_patch jsonb,
  p_requested_group_id uuid,
  p_group_label text,
  p_received_date date
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_existing public.shipments%rowtype;
  v_new public.shipments%rowtype;
  v_saved public.shipments%rowtype;
  v_group_id uuid;
  v_group jsonb;
begin
  select * into v_existing from public.shipments
  where id = p_id and is_demo = false for update;
  if not found then raise exception 'shipment not found'; end if;
  if v_existing.voided_at is not null then
    raise exception 'voided shipment must be restored before editing';
  end if;
  select * into v_new from jsonb_populate_record(v_existing, p_patch);

  v_group_id := p_requested_group_id;
  if v_group_id is null and nullif(btrim(p_group_label), '') is not null then
    select id into v_group_id from public.intake_groups
    where is_demo = false and vendor_name = v_new.vendor_name
      and received_date = coalesce(p_received_date, current_date)
      and label = btrim(p_group_label)
    limit 1;
    if v_group_id is null then
      insert into public.intake_groups (vendor_name, received_date, label, is_demo)
      values (v_new.vendor_name, coalesce(p_received_date, current_date), btrim(p_group_label), false)
      returning id into v_group_id;
    end if;
  end if;

  update public.shipments set
    vendor_name = v_new.vendor_name, vendor_id = v_new.vendor_id,
    item_name = v_new.item_name, product_id = v_new.product_id,
    material = v_new.material, process = v_new.process, boxes = v_new.boxes,
    weight_kg = v_new.weight_kg, weigh_at = v_new.weigh_at,
    location = v_new.location, status = v_new.status, due_date = v_new.due_date,
    urgent = v_new.urgent, note = v_new.note, shipped_at = v_new.shipped_at,
    intake_group_id = v_group_id, batch_label = v_new.batch_label,
    cannot_mix = v_new.cannot_mix,
    unit_price_snapshot = v_new.unit_price_snapshot, unit_snapshot = v_new.unit_snapshot,
    minimum_charge_snapshot = v_new.minimum_charge_snapshot,
    calculated_amount_snapshot = v_new.calculated_amount_snapshot,
    updated_at = v_new.updated_at
  where id = p_id and is_demo = false
  returning * into v_saved;

  if v_group_id is not null then
    select jsonb_build_object('id', id, 'label', label, 'received_date', received_date)
      into v_group from public.intake_groups where id = v_group_id;
  end if;
  return to_jsonb(v_saved) || jsonb_build_object('intake_groups', v_group);
end
$function$;

revoke all on function public.update_shipment_with_group(uuid, jsonb, uuid, text, date) from public, anon, authenticated;
grant execute on function public.update_shipment_with_group(uuid, jsonb, uuid, text, date) to service_role;
