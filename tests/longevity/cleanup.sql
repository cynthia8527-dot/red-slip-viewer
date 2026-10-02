-- Only the owned disposable test database: erase synthetic retention records at teardown.
-- Production tombstones/retirements MUST NOT be purged by application cleanup.
do $$ begin
  if exists(select 1 from public.products) or exists(select 1 from public.shipments) then
    raise exception 'Refuse synthetic retirement teardown while business fixtures remain';
  end if;
  delete from private.retired_shipment_requests;
  delete from private.retired_product_photo_paths;
end $$;
