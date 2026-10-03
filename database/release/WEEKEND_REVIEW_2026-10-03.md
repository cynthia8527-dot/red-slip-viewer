# Weekend reliability and login patch — review only

Base: released main `8d6c52f3b81f13ffe83ef02772d55514ebc5ef5c`. Local branch: `fix/vendor-import-and-taipei-period`. No push, PR, merge, deployment, production SQL, credentials or Auth settings changed for this patch.

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

- `node tests/run.mjs`: complete offline suite; includes money, upgrade/rebuild, recovery, photo/Edge contracts, existing workflow UI tests, and new import/date/login tests. Final run: 119 passed, 0 failed, 0 skipped; wall time 31.313 s. It uses real PGlite SQL with platform interfaces doubled; browser Auth responses are doubles, not real successful authentication.
- `LONGEVITY_PG_BIN=/absolute/path/to/postgres/bin node tests/longevity/native-import.mjs`: creates its own disposable PostgreSQL cluster, Unix socket only, no remote URL accepted. PostgreSQL 17.11: actual two-connection commit/retry, rollback/retry, lock timeout and earlier manual writer cases PASS. 5,000 vendor inserts plus 5,000 retry rows PASS in 0.709 s; entire native run 6.382 s. These are local wall-clock observations, not production throughput promises.
- New real-page browser cases: lost success response after SQL commit followed by reload/reimport; password failure/retry and magic fallback; reset send failure/retry; expired link; interrupted form/reload; mismatch/update failure/retry/success; inactive account and staff UI gates; recovery navigation/cancel; Taipei midnight/year/leap-month filtering, current-month following and stable manual history. Browser deliberately runs in America/Los_Angeles to catch accidental local-time use.
- The browser XLSX decoder is a test double returning worksheet arrays; actual xlsx/xls binary decoding and arbitrary user workbooks are not verified. The unchanged pinned XLSX library is not upgraded here.
- Full local Supabase Auth/PostgREST/Storage and email-link delivery have NOT been rerun for this new candidate. No Docker images are cached in this environment; the known heavy postgres image disk failure was not repeated. Earlier main CI success is not evidence that this new password flow passed real Auth. The existing full-platform CI can replay the new migration, but its historical logged-in browser suite does not yet test the new password recovery mail chain. Complete that isolated integration acceptance before release; do not silently push a new branch/PR to obtain CI permission.
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

No production URL is accepted by the native runner. The offline runner blocks non-loopback test targets. Synthetic fixtures use only `.invalid` accounts. Do not attach production credentials to these commands.
