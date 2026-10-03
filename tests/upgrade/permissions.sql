begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000002',true);
do $$ declare denied boolean:=false; begin
 if (select count(*) from public.shipments)<>2 then raise exception 'Active staff cannot read legacy ledger'; end if;
 begin insert into public.products(name) values ('forbidden staff write'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Staff gained catalog write'; end if;
end $$;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000003',true);
do $$ begin if (select count(*) from public.shipments)<>0 then raise exception 'Inactive account reads legacy ledger'; end if; end $$;
rollback;
