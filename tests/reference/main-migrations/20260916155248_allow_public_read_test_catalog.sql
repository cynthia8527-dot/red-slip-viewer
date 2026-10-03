grant usage on schema public to anon;
grant select on table public.products to anon;
grant select on table public.vendor_prices to anon;

create policy "test catalog products public read"
on public.products
for select
to anon
using (true);

create policy "test catalog prices public read"
on public.vendor_prices
for select
to anon
using (true);
