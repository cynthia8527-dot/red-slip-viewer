-- Apply only to the dedicated test project. This is not an approved main migration.
-- Existing rows are checked before adding constraints; nothing is auto-deleted.
do $guard$
begin
  if not exists (
    select 1 from test_guard.project_identity
    where project_ref = 'zfcsuxihpakrsohvcwlr'
  ) or not exists (
    select 1 from storage.buckets where id = 'factory-photos-test'
  ) or exists (
    select 1 from storage.buckets where id = 'factory-photos'
  ) then
    raise exception 'Unsafe project: confirmed contracts require the dedicated test project';
  end if;

  if exists (
    select 1 from public.vendors
    group by code, short_name having count(*) > 1
  ) then
    raise exception 'Existing duplicate vendor code and short_name pairs require review';
  end if;
  if exists (
    select 1 from public.dispatch_locations
    group by name, address having count(*) > 1
  ) then
    raise exception 'Existing duplicate dispatch name and address pairs require review';
  end if;
  if exists (
    select 1 from public.shipment_photos
    where left(storage_path, length('shipments/' || shipment_id::text || '/'))
      <> 'shipments/' || shipment_id::text || '/'
       or length(storage_path) <= length('shipments/' || shipment_id::text || '/')
  ) then
    raise exception 'Existing shipment photo paths require review';
  end if;
end
$guard$;

alter table public.vendors
  add constraint vendors_code_short_name_unique
  unique nulls not distinct (code, short_name);

alter table public.dispatch_locations
  add constraint dispatch_locations_name_address_unique
  unique (name, address);

alter table public.shipment_photos
  add constraint shipment_photos_path_matches_shipment
  check (
    left(storage_path, length('shipments/' || shipment_id::text || '/'))
      = 'shipments/' || shipment_id::text || '/'
    and length(storage_path) > length('shipments/' || shipment_id::text || '/')
  );
