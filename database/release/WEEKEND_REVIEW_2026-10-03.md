# Weekend reliability and login patch — review only

Base: released main `8d6c52f3b81f13ffe83ef02772d55514ebc5ef5c`. Local branch: `fix/vendor-import-and-taipei-period`. A new draft PR and CI push were separately authorized after the initial local review. No merge, deployment, production SQL, credentials or Auth settings changed for this patch.

## Changes

- The legacy vendor workbook is normalized using the existing field/branch rules, then sent to one `import_vendor_workbook(jsonb)` call. The whole call commits or rolls back. The database checks duplicates against current rows under a lock; no existing vendor/site is updated. Reopening and importing the same unchanged file after an uncertain response skips committed rows. This is a whole-workbook retry, not incremental resume or a permanent request-ID ledger. Do not edit/delete matching imported records between an uncertain result and retry. Existing branch classification remains heuristic and row order still matters; this patch does not silently reinterpret historical company identities.
- Client bound: 5,000 valid rows and 2 MB normalized JSON. Server bound: 5,000 rows / 2.2 MB JSONB text (includes serialization whitespace), known typed fields only, no caller IDs or references. Import takes SHARE ROW EXCLUSIVE locks on vendors/sites and waits at most five seconds for locks. Reads remain available; other writes can wait. Timeout/error is a whole-call failure, not partial success. Oversize workbooks require explicit splitting, each file its own transaction.
- Shipment filter/year options now use Asia/Taipei for both the current date and shipment timestamps. Current-month mode follows rollover on refresh/poll; manually selected history and all-period modes remain selected. The current-month button refreshes year options before selection. Existing money and snapshot code is untouched.
- Board adds email/password login, retains the original magic-link options and profile active/role checks, and routes recovery sessions to `/account/`. The account page requests recovery mail or lets an authenticated active user set their own password, checks confirmation, clears password inputs after attempts/navigation, and signs out the current device after success. No password is logged, saved by application code, or included in URLs. Password-manager browser behavior is independent. No signup, role or access-list feature is added.

## Required review before publication

1. Apply only the new `supabase/migrations/20261003024225_atomic_vendor_workbook_import.sql` to the already released schema, after review/authorization. Rebuild and upgrade copies plus manifests are synchronized for isolated tests. Do not replay the old upgrade transactions on production.
2. New RPC is SECURITY INVOKER, empty search_path, uses existing `private.is_factory_admin()` and vendor/site RLS; EXECUTE only authenticated (PUBLIC/anon/service revoked). No new tables, credentials, storage policies, or existing table grants. The function's new EXECUTE grant is the only new application permission to review.
3. Verify Auth email/password provider availability and recovery email template/redirect behavior. The exact proposed recovery redirect is `https://cynthia8527-dot.github.io/red-slip-viewer/account/`. Inspect the existing allowlist before deciding whether to add it; do not broaden it to arbitrary hosts or alter security settings implicitly. Existing board magic-link redirect stays unchanged. Password strength, rate limits, secure password change/reauthentication settings remain server-enforced; stricter production settings may require additional UI work after isolated validation. Do not disable them to make tests pass.
4. Publish UI only after the new RPC and Auth redirect are ready and separately authorized. Older UI still works against the additive RPC schema but retains its old import limitations. No Edge redeployment is needed; both Edge source hashes remain identical to the released candidate.

## Evidence and limits

- `node tests/run.mjs`: complete offline suite; includes money, upgrade/rebuild, recovery, photo/Edge contracts, existing workflow UI tests, and new import/date/login tests. Final local run: 121 passed, 0 failed, 0 skipped; 52.289 seconds (sequential test files) wall-clock. It uses real PGlite SQL with platform interfaces doubled; browser Auth responses are doubles, not real successful authentication.
- `LONGEVITY_PG_BIN=/absolute/path/to/postgres/bin node tests/longevity/native-import.mjs`: creates its own disposable PostgreSQL cluster, Unix socket only, no remote URL accepted. PostgreSQL 17.11: actual two-connection commit/retry, rollback/retry, lock timeout and earlier manual writer cases PASS. 5,000 vendor inserts plus 5,000 retry rows PASS in 0.709 s; entire native run 6.382 s. These are local wall-clock observations, not production throughput promises.
- New real-page browser cases: lost success response after SQL commit followed by reload/reimport; password failure/retry and magic fallback; reset send failure/retry; expired link; interrupted form/reload; mismatch/update failure/retry/success; inactive account and staff UI gates; recovery navigation/cancel; Taipei midnight/year/leap-month filtering, current-month following and stable manual history. Browser deliberately runs in America/Los_Angeles to catch accidental local-time use.
- The browser now decodes a real binary XLSX workbook with the actual pinned library; separate XLSX and legacy XLS round trips check leading zeros, formatted numeric phones, Unicode names and the mail sheet. Truncated XLSX and malformed/oversized RPC payloads are rejected. Arbitrary production workbooks are not sampled.
- `tests/weekend-real-platform.mjs` now passes with genuine GoTrue 2.196.0, PostgREST 14.17 (digest-pinned images, total approximately 83 MB), native PostgreSQL 17.11 and the same browser SDK 2.116.0. SMTP is a loopback, in-memory sink. It tests passwordless account initial setup through actual recovery mail, reload/interruption, password rejection/retry, persisted cross-page login, profile RLS, real concurrent import, anonymous/staff denial, committed password update with lost response, expired link, resend, cancel, used-link rejection and original magic-link fallback. The final real-platform run passed in 10.228 seconds (concurrent with the offline suite). Its local email cooldown is explicitly 1 ms and OTP lifetime 3,600 s for controlled tests; no production settings are changed. All containers, temporary DB and synthetic secrets are removed at exit. No heavy Supabase Postgres image is downloaded.
- This lightweight runner is not the entire hosted platform: Storage scaffolding and platform roles are installed locally, `auth.uid()` uses the standard JWT-claims lookup, and Edge routes are not implemented. Full fresh/upgrade/volume/recovery CI remains a separate gate. Real SMTP/Auth here does not prove hosted email deliverability, redirect allowlist or exact production Auth-version parity. CI reuses the existing standard runner and contents:read permissions; no extra secrets or paid resources.
- Supabase hosted/local advisors have not run on this candidate. Explicit SQL ACL/RLS/invoker tests pass; no production advisor/config mutation was used. Current official function/password documentation was consulted; changelog fetch was unavailable (markdown tool unsupported / local HTTP 403).

## Safe production acceptance after a separately approved release

Use an authorized session in a clean browser context with no pending photo jobs in sessionStorage. Existing page initialization can retry pending photo associations; an old context is not guaranteed read-only. Never export the user's cookies/session/password.

1. Read deployment SHA and source hashes; compare to the approved reviewed candidate. Check new module/account page HTTP status, console errors and mobile layout without submitting login/reset/import/edit forms.
2. User privately performs login or password setup if desired. No agent enters, observes, records or submits their real password. Password reset/change is an Auth write and is outside a strictly read-only acceptance pass.
3. With an existing authorized clean session, inspect vendor/site, product/price, board/history and dispatch pages; use search, pagination, historical year/month and all-period controls. Confirm staff/admin UI presentation against the existing role. Do not save forms, change statuses, upload photos, import files, trigger recovery jobs, void/delete/restore, or change prices.
4. Compare allowlisted business row counts/content hashes, frozen shipment amounts and photo references/object metadata before/after; verify backup snapshots/schedules unchanged. Do not export business rows or Auth records into logs. No synthetic rows in production.
5. Check report semantics: full import/retry and password-reset write acceptance belongs to isolated synthetic infrastructure. A read-only production pass cannot establish these write flows succeeded. Keep any remaining gap explicit.

## Reproduction

Run from repository root with the pinned dependencies installed:

```sh
node --test tests/vendor-import.test.mjs tests/taipei-period.test.mjs tests/weekend-browser.test.mjs
node tests/run.mjs
LONGEVITY_PG_BIN=/absolute/path/to/postgres/bin node tests/longevity/native-import.mjs
```

The real Auth runner additionally needs Docker, native PostgreSQL and the two image digests pinned in `.github/workflows/offline-tests.yml`:

```sh
LONGEVITY_PG_BIN=/absolute/path/to/postgres/bin node tests/weekend-real-platform.mjs
```

No production URL is accepted by the native runner. The offline runner blocks non-loopback test targets. Synthetic fixtures use only `.invalid` accounts. Do not attach production credentials to these commands.

## Security review: official parser remediation

The old browser loader and test dependency used `xlsx@0.18.5`, affected by [CVE-2023-30533 prototype pollution (<0.19.3)](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) and [CVE-2024-22363 ReDoS (<0.20.2)](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9). Both now use unmodified official SheetJS 0.20.3, which is outside both affected ranges. The browser loads checked-in ESM and codepage tables, with no third-party CDN parser request. XLSX, XLS and Big5 BIFF5 reading remain supported. This is a parser upgrade, not a format migration.

[Official installation guidance](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) explains the stale npm package and recommends vendoring the official tarball. The local CONNECT proxy rejected the official download before reaching the vendor. The already authorized standard [GitHub runner fetched the public official URL successfully](https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/37092339794), without new credentials, permissions, paid resources or unofficial mirrors. `vendor/sheetjs/source.json` records the source and SHA256 of the original tarball and extracted modules/license; the artifact ZIP hash was independently checked against GitHub's artifact metadata. The tarball SHA256 is `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`. Apache-2.0 LICENSE is retained. The locked test package installs from this same tarball; tests verify its exact version and browser distribution hashes.

`pnpm audit --json` reports zero known advisories after this replacement; no advisory was ignored or suppressed. Binary/UI regression checks XLSX/XLS import, lost-response retry and malformed workbook rejection before any RPC; a synthetic Big5 BIFF5 fixture verifies legacy codepage decoding. These tests are compatibility and provenance evidence, not exhaustive hostile-workbook fuzzing or a reproduction of every historical CVE. Parsing still runs in the browser before normalized row/payload limits, so arbitrary oversized/compressed files can exhaust client resources. No claim of general denial-of-service immunity is made. No hostile workbook was opened in production.

The migration adds an authenticated-callable RPC but preserves the existing active-admin-only write boundary using SECURITY INVOKER plus existing RLS and `private.is_factory_admin()`. Staff and inactive identities fail before table locks/writes; anonymous/service roles lack EXECUTE; caller-supplied IDs, role fields, objects in text fields, overlong fields, excessive row count and excessive payload size fail without partial state. This is a new API entry point to review, not a grant of vendor writes to additional users. Recovery redirect review adds only the exact `/account/` URL if needed, not a wildcard or authentication bypass. Password updates remain self-service through Auth with current-session validation and active profile checks in the UI; no privileged credential is shipped to browsers.

## CI scheduling correction

On parser candidate `ebd790f`, the push suite passed all 121 tests, while the separate PR suite timed out the existing 60-second UI acceptance case. In that PR run, separate browser cases took 80.441 s and 58.471 s versus ordinary seconds locally, consistent with resource contention rather than a reported application assertion failure. This is an inference from timings, not proof that every timeout is harmless. The test runner now explicitly executes files sequentially, bounding concurrent Chromium/PGlite instances on the existing standard runner. Individual deadlines, assertions and zero-skip requirements are unchanged; no test is retried automatically. The entire final suite and full platform CI must pass before declaring validation complete.

The same earlier PR platform run also had a volume job fail with `fetch failed` after Auth/RLS passed and before workflow readiness was confirmed; fresh/upgrade/recovery and all four push jobs passed. Existing logging does not identify the failed request or socket cause, so this cannot be conclusively classified. No product behavior, HTTP retry logic or platform assertion was changed to hide it. The final candidate requires all four jobs to pass; any recurrence needs request-stage/socket diagnostics before more changes or retries.
