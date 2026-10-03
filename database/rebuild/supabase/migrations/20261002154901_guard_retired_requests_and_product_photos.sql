-- Draft additive guard candidate. Requires the existing request columns/RPC candidate.
-- No production execution authorization. Retention records must survive data deletion/restarts.
begin;
set local lock_timeout = '5s';

create table private.retired_shipment_requests (
  request_id uuid primary key,
  shipment_id uuid not null,
  retired_at timestamptz not null default now()
);
alter table private.retired_shipment_requests enable row level security;
revoke all on private.retired_shipment_requests from public, anon, authenticated, service_role;

-- Trigger-only definer: preserves an invariant for otherwise-authorized DML, including
-- direct legacy deletes. It grants no new ability to select or mutate a shipment.
-- INSERT runs AFTER uniqueness checks; DELETE uses the same key lock as the create RPC.
create function private.guard_shipment_request_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' then
    if new.create_request_id is distinct from old.create_request_id
      or new.create_request_fingerprint is distinct from old.create_request_fingerprint then
      raise exception using errcode='22023', message='Idempotency-Key fields cannot be changed';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.create_request_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(old.create_request_id::text, 0));
      insert into private.retired_shipment_requests(request_id,shipment_id)
      values (old.create_request_id,old.id) on conflict (request_id) do nothing;
    end if;
    return old;
  end if;
  if new.create_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.create_request_id::text, 0));
    if exists(select 1 from private.retired_shipment_requests where request_id=new.create_request_id) then
      raise exception using errcode='22023', message='Idempotency-Key belongs to a permanently deleted shipment';
    end if;
  end if;
  return new;
end
$function$;
revoke all on function private.guard_shipment_request_lifecycle() from public, anon, authenticated, service_role;
create trigger shipments_request_insert_guard after insert on public.shipments
for each row execute function private.guard_shipment_request_lifecycle();
create trigger shipments_request_change_guard after update of create_request_id,create_request_fingerprint on public.shipments
for each row execute function private.guard_shipment_request_lifecycle();
create trigger shipments_request_delete_guard before delete on public.shipments
for each row execute function private.guard_shipment_request_lifecycle();

create table private.retired_product_photo_paths (
  storage_path text primary key,
  product_id uuid not null,
  retired_at timestamptz not null default now()
);
alter table private.retired_product_photo_paths enable row level security;
revoke all on private.retired_product_photo_paths from public, anon, authenticated, service_role;
grant select,insert on private.retired_product_photo_paths to service_role;

-- AFTER trigger means inserts have already passed the product UUID uniqueness check.
-- Updates already hold the product row lock shared with the cleanup-claim RPC.
-- This also protects direct authenticated catalog edits, not only the new Edge handler.
create function private.guard_product_photo_path()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if tg_op='UPDATE' then
    if new.reference_photo_path is not distinct from old.reference_photo_path
      and new.id is not distinct from old.id then return new; end if;
  end if;
  if new.reference_photo_path is null then return new; end if;
  if left(new.reference_photo_path,length('products/'||new.id::text||'/')) <> 'products/'||new.id::text||'/'
    or length(new.reference_photo_path) <= length('products/'||new.id::text||'/') then
    raise exception using errcode='22023', message='Product photo path must belong to this product';
  end if;
  if exists(select 1 from private.retired_product_photo_paths where storage_path=new.reference_photo_path) then
    raise exception using errcode='22023', message='Product photo path is retired; upload to a new path';
  end if;
  return new;
end
$function$;
revoke all on function private.guard_product_photo_path() from public, anon, authenticated, service_role;
create trigger products_photo_path_guard after insert or update of reference_photo_path,id on public.products
for each row execute function private.guard_product_photo_path();

-- Claim commits BEFORE any Storage deletion. A claimed path can never be linked again.
-- New uploads use fresh UUID paths. No TTL: deleting a retirement can reopen the race.
create function public.claim_product_photo_cleanup(p_product_id uuid, p_storage_path text)
returns boolean language plpgsql security invoker set search_path = '' as $function$
begin
  if p_product_id is null or p_storage_path is null
    or left(p_storage_path,length('products/'||p_product_id::text||'/')) <> 'products/'||p_product_id::text||'/'
    or length(p_storage_path) <= length('products/'||p_product_id::text||'/') then
    raise exception using errcode='22023', message='Invalid product photo cleanup path';
  end if;
  perform 1 from public.products where id=p_product_id for update;
  if not found then return false; end if;
  -- Also preserve any legacy cross-product reference; new cross-product links are rejected.
  if exists(select 1 from public.products where reference_photo_path=p_storage_path) then return false; end if;
  insert into private.retired_product_photo_paths(storage_path,product_id)
  values(p_storage_path,p_product_id) on conflict(storage_path) do nothing;
  return true;
end
$function$;
revoke all on function public.claim_product_photo_cleanup(uuid,text) from public, anon, authenticated;
grant execute on function public.claim_product_photo_cleanup(uuid,text) to service_role;
commit;
