
alter table public.shipments
  add column if not exists unit_price_snapshot numeric null,
  add column if not exists unit_snapshot text null,
  add column if not exists minimum_charge_snapshot numeric null,
  add column if not exists calculated_amount_snapshot numeric null;

comment on column public.shipments.unit_price_snapshot is 'Vendor unit price captured when shipment is marked shipped.';
comment on column public.shipments.unit_snapshot is 'Pricing unit captured when shipment is marked shipped.';
comment on column public.shipments.minimum_charge_snapshot is 'Minimum charge captured when shipment is marked shipped.';
comment on column public.shipments.calculated_amount_snapshot is 'Calculated amount captured when shipment is marked shipped.';
