create policy "factory shipment photos active insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'factory-photos'
  and private.is_active_factory_user()
  and (storage.foldername(name))[1] = 'shipments'
);
