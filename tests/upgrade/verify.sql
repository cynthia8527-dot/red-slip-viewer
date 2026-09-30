do $verify$
begin
 if upgrade_proof.capture() is distinct from (select data from upgrade_proof.before_data) then raise exception 'Upgrade modified legacy rows, amounts, IDs, timestamps, or relationships'; end if;
 if exists (select * from upgrade_proof.before_security except select c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') then raise exception 'Upgrade changed existing table grants/RLS'; end if;
 if exists (select * from upgrade_proof.before_policies except select * from pg_policies where schemaname in ('public','storage')) or exists (select * from pg_policies where schemaname in ('public','storage') except select * from upgrade_proof.before_policies) then raise exception 'Upgrade changed existing access policies'; end if;
 if exists(select 1 from public.shipments where create_request_id is not null or create_request_fingerprint is not null) or exists(select 1 from public.products where quick_create_request_id is not null or quick_create_request_fingerprint is not null) then raise exception 'Legacy rows unexpectedly backfilled'; end if;
end $verify$;
-- Old-style writes remain accepted, and updating unrelated fields preserves snapshots.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
update public.shipments set note='Legacy update' where id='a1100000-0000-4000-8000-000000000051';
do $$ begin
 if not exists(select 1 from public.shipments where id='a1100000-0000-4000-8000-000000000051' and note='Legacy update' and calculated_amount_snapshot=864.15 and unit_price_snapshot=70) then raise exception 'Legacy write lost price snapshot'; end if;
end $$;
rollback;
