-- Reconstructed on 2026-09-30; not recovered migration history or deployment approval.

-- SOURCE supabase/migrations/20260930040920_add_idempotency_request_columns.sql SHA256 7402bdff1e4decb3a5e4fd9884bfa6518236a9e15a1a251a623fb71209853a53 (verbatim)
-- Review candidate: additive request columns only, not a complete baseline.
-- Does not install RPCs or authorize publishing dependent clients.
-- Deliberately fail on existing columns/indexes; review schema drift first.
begin;
set local lock_timeout = '5s';

alter table public.shipments
  add column create_request_id uuid,
  add column create_request_fingerprint text,
  add constraint shipments_create_request_pair_check check (
    (create_request_id is null and create_request_fingerprint is null)
    or (create_request_id is not null and create_request_fingerprint is not null
      and create_request_fingerprint ~ '^[0-9a-f]{64}$')
  );
create unique index shipments_create_request_id_uidx
  on public.shipments (create_request_id) where create_request_id is not null;

alter table public.products
  add column quick_create_request_id uuid,
  add column quick_create_request_fingerprint text,
  add constraint products_quick_create_request_pair check (
    (quick_create_request_id is null and quick_create_request_fingerprint is null)
    or (quick_create_request_id is not null and quick_create_request_fingerprint is not null
      and quick_create_request_fingerprint ~ '^[0-9a-f]{64}$')
  );
create unique index products_quick_create_request_id_idx
  on public.products (quick_create_request_id) where quick_create_request_id is not null;
commit;

