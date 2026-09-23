alter table public.vendor_prices
add column if not exists minimum_charge numeric null;

comment on column public.vendor_prices.minimum_charge is 'Minimum charge amount for this vendor/product price rule. Null means no minimum charge.';
