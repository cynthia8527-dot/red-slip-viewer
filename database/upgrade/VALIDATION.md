# Upgrade rehearsal evidence — 2026-09-30

Implementation SHA: `13ed961cecdd7209f66dfefbf6a16d60f57710b4` (based on `b393a9c4fc497f9a28e2ecd1b45a958a1dafd231`).

- `node --test tests/upgrade.test.mjs`: 1 passed, 0 failed/skipped; PGlite contract platform only.
- `pnpm test`: 92 passed, 0 failed/skipped, including all existing offline/browser coverage and the new upgrade regression.
- Native full Supabase Docker, push: https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36692836168 — fresh and upgrade jobs success.
- Native full Supabase Docker, PR: https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36692841423 — fresh and upgrade jobs success.
- Both offline CI events for the same SHA succeeded: https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36692836109 and https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36692841422 .

Native upgrade logs verify all four rejected-upgrade scenarios, legacy row/relationship/amount/permission preservation, old-style writes, final reconstructed catalog and the existing 14 SQL cases. The real local Edge workflow passes shipment posting, photo attach/replacement/replay, concurrent same-key retry, changed-content conflict, preserved posted amount after a price change, ledger/image reads, void/delete retry and finite metadata/bytes cleanup checks. Final public/private rows, Auth users/sessions/refresh tokens and Storage objects are all zero; disposable containers and volumes removed.

Fixed toolchain: Supabase CLI 2.118.0, Node 24.19.0, pnpm 11.19.0; local Edge test import map pins supabase-js 2.117.2. Repository lockfile installs preserved. Sources are copied unchanged for local serving, JWT verification remains enabled and an invalid JWT is rejected. No remote function deployment, repository secret, existing remote schema change or credential change was needed. Source/log JWT scan found none.

Limitations: this proves only the documented reconstructed legacy boundary plus synthetic data. The legacy photo records contain metadata without imported old image bytes; live-browser end-to-end integration, current production drift, real historical conflicts, load/locking, rollout and external backup/restore are not established. Existing remote test-site 18-case suite was not rerun this round. Historical inventory remains exit 2; it is not relabeled as a complete original migration history. Local Docker remains blocked by registry Forbidden; native evidence above is from GitHub runners.
