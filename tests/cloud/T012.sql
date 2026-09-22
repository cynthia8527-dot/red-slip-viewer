-- A failed multi-row operation in one database transaction must leave no product.
-- This does not prove that the current frontend quick-add uses one transaction.
do $test$
declare v_rejected boolean := false;
begin
  perform 1 from test_guard.project_identity where project_ref='zfcsuxihpakrsohvcwlr';
  if not found then raise exception 'T012 unsafe project'; end if;
  begin
    insert into public.products (id,name)
    values ('c0d00000-0000-4000-8000-000000000116','[TEST] partial product');
    insert into public.vendor_prices (id,vendor_name,vendor_id,product_id,unit_price)
    values ('c0d00000-0000-4000-8000-000000000117','[TEST] invalid',
      'c0d00000-0000-4000-8000-000000000999',
      'c0d00000-0000-4000-8000-000000000116',1);
  exception when foreign_key_violation then v_rejected := true;
  end;
  if not v_rejected or exists (
    select 1 from public.products where id='c0d00000-0000-4000-8000-000000000116'
  ) then
    raise exception 'T012 FAIL: invalid operation rejected %, partial product exists %',
      v_rejected,exists(select 1 from public.products where id='c0d00000-0000-4000-8000-000000000116');
  end if;
end
$test$;
select 'T012 PASS' as result;
