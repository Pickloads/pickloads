-- ============================================================================
-- PickLoads — Migration 0004: Storage — private bucket `carrier-docs`
--
-- Arch §4: "Jamais de bucket public pour les W-9 et certificats d'assurance."
-- Audit S-01: W-9s / voided checks contain SSN/EIN/bank data.
--   * Bucket is PRIVATE; the app serves files exclusively via short-lived
--     signed URLs generated server-side (≤ 5 minutes).
--   * Object paths are namespaced by carrier id:  {carrier_id}/{uuid}-{filename}
--   * 10 MB per-file cap and an explicit MIME allow-list at the bucket level;
--     server-side magic-byte validation happens in the upload handler (S-03).
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'carrier-docs',
  'carrier-docs',
  false,
  10485760, -- 10 MB
  array['application/pdf','image/jpeg','image/png','image/heic']
)
on conflict (id) do nothing;

-- Staff can read/manage every object in the bucket.
create policy "staff manage carrier docs" on storage.objects
  for all
  using (bucket_id = 'carrier-docs' and public.is_staff())
  with check (bucket_id = 'carrier-docs' and public.is_staff());

-- A carrier can read only objects under their own carrier-id prefix.
create policy "carrier read own folder" on storage.objects
  for select
  using (
    bucket_id = 'carrier-docs'
    and (storage.foldername(name))[1] in (
      select c.id::text from public.carriers c where c.profile_id = auth.uid()
    )
  );

-- A carrier can upload only into their own folder (Phase 2 portal uploads go
-- through the server anyway; this is defense in depth).
create policy "carrier upload own folder" on storage.objects
  for insert
  with check (
    bucket_id = 'carrier-docs'
    and (storage.foldername(name))[1] in (
      select c.id::text from public.carriers c where c.profile_id = auth.uid()
    )
  );
