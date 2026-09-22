-- Test-project reconstruction of an index present in the main project but absent
-- from its recorded migration statements. Do not apply to main as a new change.
create index shipments_voided_by_idx on public.shipments (voided_by);
