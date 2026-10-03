-- Verify real RLS policies under the authenticated database role, without
-- creating a login-capable account. The entire fixture is rolled back.
begin;
do $guard$
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T026 unsafe project'; end if;
end
$guard$;

insert into auth.users (id,email) values
  ('c0d00000-0000-4000-8000-000000000201','t026-admin@example.invalid'),
  ('c0d00000-0000-4000-8000-000000000202','t026-staff@example.invalid'),
  ('c0d00000-0000-4000-8000-000000000203','t026-unapproved@example.invalid');
insert into public.profiles (user_id,email,role,active) values
  ('c0d00000-0000-4000-8000-000000000201','t026-admin@example.invalid','admin',true),
  ('c0d00000-0000-4000-8000-000000000202','t026-staff@example.invalid','staff',true);

set local role authenticated;
select set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000201',true);
do $admin$
begin
  if auth.uid() <> 'c0d00000-0000-4000-8000-000000000201'::uuid then
    raise exception 'T026 FAIL: admin identity was not applied';
  end if;
  insert into public.vendors (id,code,short_name)
  values ('c0d00000-0000-4000-8000-000000000204','[TEST]-T026','[TEST] RLS vendor');
  insert into public.dispatch_locations (id,name,address)
  values ('c0d00000-0000-4000-8000-000000000205','[TEST] RLS dispatch','[TEST] RLS address');
end
$admin$;

select set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000202',true);
do $staff$
declare v_rejected boolean := false;
begin
  if (select count(*) from public.vendors where code='[TEST]-T026') <> 1 then
    raise exception 'T026 FAIL: active staff could not read vendor';
  end if;
  begin
    insert into public.dispatch_locations (id,name,address)
    values ('c0d00000-0000-4000-8000-000000000206','[TEST] staff write','[TEST] address');
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'T026 FAIL: staff inserted admin-only dispatch location'; end if;
end
$staff$;

select set_config('request.jwt.claim.sub','c0d00000-0000-4000-8000-000000000203',true);
do $unapproved$
declare v_rejected boolean := false;
begin
  if (select count(*) from public.vendors where code='[TEST]-T026') <> 0 then
    raise exception 'T026 FAIL: unapproved user read vendor';
  end if;
  begin
    insert into public.vendors (id,code,short_name)
    values ('c0d00000-0000-4000-8000-000000000207','[TEST]-unapproved','[TEST] blocked');
  exception when insufficient_privilege then v_rejected := true;
  end;
  if not v_rejected then raise exception 'T026 FAIL: unapproved user inserted vendor'; end if;
end
$unapproved$;

rollback;
select 'T026 PASS' as result;
