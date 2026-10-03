-- Tighten product and price write permissions to admins only.
drop policy if exists "products active staff insert" on public.products;
drop policy if exists "products active staff update" on public.products;
drop policy if exists "vendor prices active staff insert" on public.vendor_prices;
drop policy if exists "vendor prices active staff update" on public.vendor_prices;

create policy "products admin insert"
on public.products for insert
to authenticated
with check (private.is_factory_admin());

create policy "products admin update"
on public.products for update
to authenticated
using (private.is_factory_admin())
with check (private.is_factory_admin());

create policy "vendor prices admin insert"
on public.vendor_prices for insert
to authenticated
with check (private.is_factory_admin());

create policy "vendor prices admin update"
on public.vendor_prices for update
to authenticated
using (private.is_factory_admin())
with check (private.is_factory_admin());

-- Keep the shared photo bucket private and cap uploads at 10 MB.
update storage.buckets
set public = false,
    file_size_limit = 10485760
where id = 'factory-photos';

-- Private photo access: active factory users may view; admins manage files.
drop policy if exists "factory photos active read" on storage.objects;
drop policy if exists "factory photos admin insert" on storage.objects;
drop policy if exists "factory photos admin update" on storage.objects;
drop policy if exists "factory photos admin delete" on storage.objects;

create policy "factory photos active read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_active_factory_user()
);

create policy "factory photos admin insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

create policy "factory photos admin update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
)
with check (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

create policy "factory photos admin delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'factory-photos'
  and private.is_factory_admin()
);

-- Maintain updated_at automatically for catalog records.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.set_updated_at() from public;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row execute function private.set_updated_at();

drop trigger if exists vendor_prices_set_updated_at on public.vendor_prices;
create trigger vendor_prices_set_updated_at
before update on public.vendor_prices
for each row execute function private.set_updated_at();
