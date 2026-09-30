-- Only synthetic rows in a newly created disposable platform.
insert into auth.users(id,email) values
 ('a1100000-0000-4000-8000-000000000001','legacy-admin@example.invalid'),
 ('a1100000-0000-4000-8000-000000000002','legacy-staff@example.invalid'),
 ('a1100000-0000-4000-8000-000000000003','legacy-inactive@example.invalid');
insert into public.profiles(user_id,email,role,active) values
 ('a1100000-0000-4000-8000-000000000001','legacy-admin@example.invalid','admin',true),
 ('a1100000-0000-4000-8000-000000000002','legacy-staff@example.invalid','staff',true),
 ('a1100000-0000-4000-8000-000000000003','legacy-inactive@example.invalid','staff',false);
insert into public.products(id,name,material,reference_photo_path) values
 ('a1100000-0000-4000-8000-000000000011','Synthetic legacy product','steel','products/a1100000-0000-4000-8000-000000000011/legacy.png');
insert into public.vendors(id,code,short_name) values
 ('a1100000-0000-4000-8000-000000000021',null,'Synthetic legacy vendor');
insert into public.vendor_sites(id,vendor_id,site_name) values
 ('a1100000-0000-4000-8000-000000000022','a1100000-0000-4000-8000-000000000021','Synthetic site');
insert into public.vendor_prices(id,vendor_name,vendor_id,product_id,unit_price,minimum_charge,effective_date,end_date) values
 ('a1100000-0000-4000-8000-000000000031','Synthetic legacy vendor','a1100000-0000-4000-8000-000000000021','a1100000-0000-4000-8000-000000000011',70,500,'2025-01-01','2025-12-31'),
 ('a1100000-0000-4000-8000-000000000032','Synthetic legacy vendor','a1100000-0000-4000-8000-000000000021','a1100000-0000-4000-8000-000000000011',100,800,'2026-01-01',null);
insert into public.intake_groups(id,vendor_name,label,received_date) values
 ('a1100000-0000-4000-8000-000000000041','Synthetic legacy vendor','Legacy group','2025-06-01');
insert into public.shipments(id,vendor_name,vendor_id,item_name,product_id,intake_group_id,location,status,weight_kg,unit_price_snapshot,unit_snapshot,minimum_charge_snapshot,calculated_amount_snapshot,shipped_at) values
 ('a1100000-0000-4000-8000-000000000051','Synthetic legacy vendor','a1100000-0000-4000-8000-000000000021','Synthetic legacy item','a1100000-0000-4000-8000-000000000011','a1100000-0000-4000-8000-000000000041','蘆洲','已出貨',12.345,70,'kg',500,864.15,'2025-06-02T00:00:00Z');
insert into public.shipments(id,vendor_name,item_name,location,status,voided_at,void_reason,voided_by) values
 ('a1100000-0000-4000-8000-000000000052','Historical free-text vendor','Voided legacy item','五股','未開始','2025-06-03T00:00:00Z','Synthetic void','a1100000-0000-4000-8000-000000000001');
insert into public.shipment_photos(id,shipment_id,storage_path,caption) values
 ('a1100000-0000-4000-8000-000000000061','a1100000-0000-4000-8000-000000000051','shipments/a1100000-0000-4000-8000-000000000051/legacy.png','Synthetic metadata; no imported private bytes');
insert into public.dispatch_locations(id,name,address,is_active) values
 ('a1100000-0000-4000-8000-000000000071','Synthetic dispatch','Synthetic address',false);
create schema upgrade_proof;
create function upgrade_proof.capture() returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; r record; rows jsonb;
begin
 for r in select tablename from pg_tables where schemaname='public' order by tablename loop
  execute format('select coalesce(jsonb_agg(j order by j::text),''[]''::jsonb) from (select to_jsonb(t) - array[''create_request_id'',''create_request_fingerprint'',''quick_create_request_id'',''quick_create_request_fingerprint''] as j from public.%I t) s',r.tablename) into rows;
  result := result || jsonb_build_object(r.tablename,rows);
 end loop;
 return result;
end $$;
create table upgrade_proof.before_data as select upgrade_proof.capture() data;
create table upgrade_proof.before_security as
 select c.relname,c.relrowsecurity,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';
create table upgrade_proof.before_policies as select * from pg_policies where schemaname in ('public','storage');
