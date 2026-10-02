# Accelerated operating-year tests and scoped reliability fixes

Starting candidate: `724a8830ebf1a745d9a2c0c8a0fbf0cdb8e1768b`, draft PR #3.
See `FIX_REPORT_2026-10-02.md` for the current scoped result. `REPORT_2026-10-02.md`
is the historical investigation before fixes. No production data or deployment was touched.
The deletion-retry and concurrent-photo issues are fixed in the candidate; exact monetary
precision and midnight calendar filtering remain explicit known limitations.

## Reproduce

Use the repository's locked dependencies (Node 24, PGlite 0.5.8):

```sh
npm test
node tests/longevity/run.mjs
node --test --test-reporter=tap tests/longevity/high-risk.test.mjs tests/longevity/guards.test.mjs
node --test --test-reporter=tap tests/longevity/risks.test.mjs
node --test --test-reporter=tap tests/longevity/upgrade.test.mjs
node tests/longevity/money-impact.mjs
```

`npm test`: 108 pass / zero fail / zero skip (original 100 plus eight regressions).
The three-seed annual command deliberately still exits **1** for exact money; its
other model invariants, including repeated deleted-key rejection and photo races, pass.
`high-risk` + `guards`: seven passing tests. `risks.test.mjs`: two strict failures,
L001 exact money and L003 midnight calendar filtering, deliberately outside the
approved fixes. They are not converted into green expected-failure tests. Upgrade
passes preservation and separately prints 144 exact-money mismatches. A structural
pass does not certify precision. No workflow, runner, permission or credential changed.

For real PostgreSQL lock contention (five actual two-connection waits):

```sh
LONGEVITY_PG_BIN=/absolute/path/to/postgresql/bin node tests/longevity/native-concurrency.mjs
```

This requires already-installed PostgreSQL binaries with pgcrypto. It creates and
removes its own cluster and private Unix socket, listens on no TCP interface,
and accepts no connection URL. Locally verified with Debian PostgreSQL 17.11;
this is not the full Supabase platform or a real Storage concurrency test.

Single-seed/replay commands:

```sh
node tests/longevity/run.mjs --seed 34087
node tests/longevity/run.mjs --seed 34087 --trace tests/tmp/longevity/failure-34087.json --shrink
node --test --test-name-pattern=L002 tests/longevity/risks.test.mjs
```

`--trace` requires a generated failure trace. Unexpected sequence failures save the
first failing prefix with seed/step/operation. Optional `--shrink` uses bounded
(80 trials) delta debugging, accepts only the same error signature, and rejects
missing model dependencies. It reports whether deletion-minimality was established;
it does not promise a globally shortest trace. The observed product issues
have explicit short independent reproducers below; no expensive whole-year reducer
was needed or run for them. SQL-generated UUIDs/timestamps are not seeded; logical
request IDs, business inputs and operation order are reproducible.

## What is real, what is simulated

- Actual versioned reconstruction SQL is hash-verified and executed in PGlite.
  Actual `shipments` / `product-photos` TypeScript source executes in a VM with
  imports removed, using Node's type stripper. Business handler logic is unchanged.
- The Supabase query adapter executes SQL against PGlite, including real RPCs,
  constraints and transactions. It intentionally returns full selected rows and
  only models the query methods used by these handlers. Pages are capped at 37 to
  force many cursor reads from modest accumulated datasets. This is not PostgREST.
- Auth identity is a synthetic active admin; Storage is a Map of synthetic bytes.
  No network client, Supabase URL, credential or remote database is accepted.
  This does not revalidate JWT, RLS, real HTTP/Storage, concurrency or photo codecs.
- Only handler `Date` is accelerated. Database `now()`, system time and timers
  remain real. Simulated time is supplied explicitly to supported date operations;
  it cannot establish expiration, scheduled-job, token-aging or uptime guarantees.
- `dumpDataDir` / close / fresh PGlite instance reloads the database image; every
  public/private/auth table is compared field-for-field. Stub Storage remains in
  the test process. This is a graceful DB restart, not crash recovery or full
  Supabase disaster recovery. Three seeds each include one pending-cleanup restart.
- No return/refund workflow is invented. Tests use supported void, restore,
  permanent delete and status reversal. Deliberately changing shipped back to
  ready then shipping again clears/recalculates the snapshot by existing design;
  a duplicate shipped PATCH, note edit, void/restore or catalog change must preserve
  the existing frozen snapshot exactly.

## Scenario and independent oracles

Three xorshift32 seeds: `34087` (`0x8527`), `539492905` (`0x20280229`),
`12648430` (`0xc0ffee`). Each independently runs 12 monthly batches,
2027-11 through 2028-10, 16 new shipments per batch plus five boundary probes.
Random choices vary weights, branch patterns (group move / void / delete), and
monthly replacement prices; the supported lifecycle template is intentionally
bounded, not exhaustive arbitrary state-machine exploration.

Future periods are installed first, then a historical period split; each month
also changes a price after shipments already exist. Frontend price selection and
real Edge price selection are checked at Taipei midnight, leap day, March 1,
and New Year 2029. Separate boundary probes intentionally revisit earlier dates;
they are not a claim of monotonically elapsed time.

Independent model tracks each logical request's live/deleted state, group, void
state, shipped time and frozen price. Every touched row and every monthly complete
list is compared. Money oracle uses integer cents × integer grams, units of
1/100000 currency (plus minimum charge), not floating multiplication. Tests retain
all exact mismatches and fail overall. Numerical magnitude tolerance (1e-9) is a
separate check, never an exact-money PASS. Raw frozen fields must additionally be
byte/value-identical across later operations; there is no tolerance for rewriting
stored snapshots. No cash ledger/payment feature exists in this test scope.

Failure injection covers a real grouped-update constraint failure after group
creation, later-page read failure with no partial published response, Storage
remove failure with durable cleanup retry, and late DDL conflict in populated
legacy upgrade. Monthly audits check exact ID sets, key uniqueness, FK targets,
photo references, absence of untracked objects, completed job paths and attempts.

## Original short product-risk reproducers (before the guards)

| ID | Severity / finding | Minimal operations after fixture setup |
|---|---|---|
| L001 | Medium: persisted monetary precision | Price 0.10/kg exists; one POST shipped at 3 kg stores `0.30000000000000004`, while SQL numeric equality to 0.30 is false. No visible cent-level overcharge demonstrated. |
| L002 | High, conditional delayed retry: deleted shipment resurrection | POST with request key K → PATCH void → DELETE → POST same original body and K later. Returns 201, replayed=false, different shipment UUID. Original is deleted; this is unwanted resurrection, not two simultaneous copies. Retention/expiry semantics for old operation keys need an explicit product decision. |
| L003 | Medium: month/year report omission | A shipped timestamp `2027-12-31T16:00:00+00:00` is Jan 1, 2028 in Taipei; run actual `board` visible predicate with year=2028/month=01. It rejects the row because it slices UTC text. One predicate call; not a new browser test. |
| L004 | High, already known: photo DB/Storage inconsistency | Start at old image O; A links new N and finishes its final reference check; pause A immediately before removing O; B links O back and removes N; resume A removing O. Both real handlers return 201, DB references missing O. Two controlled handler requests with SQL plus Storage double; not a new real-Storage concurrency claim. |

L002/L004 now pass in `high-risk.test.mjs`: a deleted request returns 409 without
recreation; relinking a retired photo returns 409 and the current image survives.
L001/L003 still assert the desired safe result and FAIL in `risks.test.mjs`.
Monetary rounding still needs a defined scale/rule; calendar filtering was explicitly
deferred. See the fix report for SQL security, retention and rollback requirements.

## Coverage not duplicated / limits

Existing reports already cover 100 isolated tests, basic real UI with intercepted
APIs, full-platform fresh/upgrade/volume/recovery CI and a 3000-product/10000-shipment
volume job. See `tests/acceptance/VALIDATION_2026-10-02.md`, `tests/volume/README.md`,
`tests/recovery/README.md`, and `tests/MULTI_WRITE_RISK_REVIEW.md`. This investigation
adds *repeated temporal interactions*, not a larger volume record or new full
platform green status. Old CI evidence belongs to its recorded SHA, not this work.

Not covered: actual year-long load or leak accumulation, parallel DB connections,
many real users, browser session loss, closing the tab with pending upload, slow
real Storage / durable image recovery, background cleanup (none exists), payment
reconciliation, Excel batch atomicity, online DB+Storage backup consistency,
production-specific migration drift, Auth/cron/key restoration, and every timezone.
No container download was attempted; only lightweight PostgreSQL packages were used for the native lock test. Full-platform capacity and production MCP
approval blockers were neither retried nor bypassed.

## Added monthly guard coverage

The same seeds/5,654 generated operations retain their original branches and monetary
oracle. Each deleted-shipment retry now also resends its consumed create key and must
receive 409. Each month performs a product-photo replacement: alternating a deliberately
interleaved old-path relink (rejected) and a Storage cleanup failure/retry. Audits include
the one current product image and durable request retirements. Retired paths/keys survive
the existing twelve database image restarts; no metadata TTL or cleanup worker is added.

New guard schema is generated by the CLI, source/hash-verified in reconstruction, and
applied as a separate follow-up transaction during legacy upgrade. Test-only teardown
erases retention records only in owned disposable databases with no product/shipment
fixtures left. Never use that teardown as an application retention policy.
