# Synthetic business-data and photo recovery rehearsal

Run only through `node tests/rebuild/full-platform.mjs --recovery` with the
pinned CLI provided by the Full Supabase rebuild workflow. The harness creates
an empty, randomly named, unlinked Docker platform, generates temporary Auth
configuration, and removes containers/volumes afterward. No remote credentials,
production backup, persistent integration, Google Drive or paid service is used.

This is **data-loss recovery with schema and Auth retained**, not a whole-platform
disaster recovery claim. PostgreSQL's native `pg_dump` custom data archive includes
all public/private business tables; real Storage API downloads preserve image
bytes separately. The official Supabase documentation confirms database backups
do not include Storage objects: https://supabase.com/docs/guides/platform/backups.
`pg_restore --single-transaction --exit-on-error` restores data without disabling
constraints or changing grants/RLS. Auth identities, schema, Storage bucket settings,
role credentials and encryption keys are deliberately outside this archive.

Bounded fixture: one product, one vendor/site, two historical prices (70 then 100),
one intake group, two shipments (including a voided record), one dispatch location,
one product image and one shipment image with distinct valid PNG bytes. This reuses
the documented upgrade fixture's business rows; only the throwaway Auth identity
is substituted. All 11 business tables are compared byte-for-byte as canonical
JSON, including UUIDs, timestamps, relationships and the historical 864.15 amount.
Empty tables are checked too; this does not cover every possible business state.

Evidence required:

- Archive SHA-256 and exact photo inventory checked before deleting anything.
- Truncated dump, missing/extra/swapped/corrupt image detection (unit tests);
  native rehearsal also rejects truncated dump and missing/corrupt image archives.
- Business rows and Storage objects removed only from the newly owned platform.
- Database-only restore must FAIL the missing-photo audit.
- Combined restoration preserves rows, links and actual authenticated image bytes.
- Altered live image and accounting amount must fail the audit; restore again.
- Existing Auth access and unchanged RLS/grants; final fixture and platform cleanup.

The workload is quiescent: it does not establish a consistent online backup across
simultaneous database and Storage writes. Checksums detect accidental corruption,
not malicious replacement of both archive and manifest. Backup bytes stay in
memory, are not uploaded as CI artifacts and are discarded after the job. This
is a test script, not a production backup schedule, retention policy, off-site
backup, account recovery or a production restore runbook. Production configuration,
restore authorization, recovery objectives and a full-platform restore remain
separate work. The previous volume and upgrade jobs continue unchanged.
