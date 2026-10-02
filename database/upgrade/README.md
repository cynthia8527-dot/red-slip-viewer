# Synthetic legacy upgrade rehearsal (not a production migration approval)

The supported starting point is the **reconstructed legacy boundary** from `database/rebuild/manifest.json`: 13 preserved historical SQL sources plus the two explicitly observed DDL gaps and qualified pgcrypto dependency. It is created only in a new disposable database. It is not a dump of the current production schema and does not prove that production matches this boundary. No production data is downloaded.

`manifest.json` hashes the boundary and both existing incremental candidate sources. CLI 2.118.0 generated `20260930085010_upgrade_reconstructed_legacy_business.sql`. The candidate uses a new preflight plus the request-column and contract/RPC sources, removing only standalone top-level BEGIN/COMMIT lines so the whole upgrade commits together. It never applies the fresh baseline to a populated database.

## Compatibility and DDL review

- Adds four nullable request columns, strict pair/check constraints and partial unique indexes. Existing rows retain NULL request fields.
- Adds vendor `(code,short_name) NULLS NOT DISTINCT` uniqueness, dispatch `(name,address)` uniqueness and shipment-photo path constraints. These tighten accepted data and may reject real historical rows. Preflight explicitly rejects duplicates/malformed paths; no deduplication or data rewrite occurs.
- Installs invoker business RPCs and private deletion-job table/permissions, preserving old RPC signatures defined in the candidate. Existing business-table grants, RLS flags and policies are compared before/after exactly.
- No DROP TABLE, TRUNCATE, column removal, UPDATE backfill, object deletion or type conversion runs during migration. UPDATE/DELETE statements inside RPC bodies run only when those APIs are called.
- Constraints/indexes can lock and scan large tables; lock_timeout is 5 seconds. This small synthetic exercise does not establish production lock duration, throughput or safe deployment timing.
- Schema divergence (existing request columns/RPC return-type conflict, missing dependencies) aborts. This path intentionally does not silently absorb other migration states. Current production state and any existing backup/cron/anonymous-read history require separate review.

## Executed checks

`tests/upgrade/rehearsal.mjs` is shared by offline PGlite and native PostgreSQL CI. Fixtures include an admin, active and inactive staff, linked vendor/site/product/prices/group/shipment/photo metadata, a voided free-text shipment, inactive dispatch address, an expired price of 70 and current price of 100, and a shipped amount of 864.15. All original row values (including UUIDs, timestamps, nullable fields, relationships and snapshots) must remain byte-equivalent as JSON after excluding only the four newly added NULL columns.

Four rejection cases verify both data preservation and absence of partial DDL: duplicate NULL vendor pairs, duplicate dispatch addresses, wrong shipment photo paths, and a late RPC return-type conflict after earlier DDL has executed. A successful upgrade also exercises old-style writes and staff/inactive authorization boundaries, then removes its exact fixture rows.

GitHub's `upgrade` matrix job starts a fresh complete Supabase platform (CLI 2.118.0, Docker), builds the legacy boundary, loads fixtures, runs the upgrade rehearsal, and runs the existing schema regression plus 14 SQL cases. It then serves the two unchanged repository Edge Functions locally with JWT verification enabled and an import map pinned to official supabase-js 2.117.2; nothing is deployed remotely.

The real HTTP flow logs in, creates a product with a price, posts a shipped item, attaches a shipment photo, changes the product reference photo, retries concurrently with the same request key, rejects changed contents with the same key, and reads back a single ledger entry plus its image bytes. A later price change must leave the posted amount unchanged. It verifies missing-object 409 semantics, photo replay, old-image cleanup, void/delete retry, then zero final fixture/account/session/object residue. Storage absence requires both metadata and actual bytes with finite retries. Browser interaction remains covered separately by the offline browser tests; this real-platform flow is API-level, not a real-browser end-to-end test.

Existing legacy photo **metadata** is synthetic; it is not a preservation test of pre-existing physical files. Platform identity-provider integrations, live production schema/data, operational scale, live-user rollout, external backup/restore, and concurrent edits from different real users are outside this evidence. Historical inventory still returns exit 2, independently of this reconstructed candidate.

Commands:

```sh
node --test tests/upgrade.test.mjs
pnpm test
REBUILD_CLI=/path/to/pinned/supabase node tests/rebuild/full-platform.mjs --upgrade
```

The platform script accepts no remote database URL, never links a project, verifies an unused random local Docker project and empty public schema, and tears down without retaining volumes. No repository secrets are used. Local Docker image pulls may be blocked by registry Forbidden; only GitHub successful native-platform runs count as full-platform evidence.


## 2026-10-02 reliability follow-up

The manifests now also include `20261002154901_guard_retired_requests_and_product_photos.sql`.
Reconstruction replays it last. Legacy upgrade preserves the original bundle, then applies
the hash-verified `followups` in order, each in its own transaction. Stop on any failure;
do not deploy the new photo Edge before the cleanup-claim RPC exists. Preserve both private
retirement tables across backups/restarts; test-only teardown is not a production purge policy.
See `tests/longevity/FIX_REPORT_2026-10-02.md` and the updated release plan. No prior release
approval or old CI SHA authorizes this new candidate.
