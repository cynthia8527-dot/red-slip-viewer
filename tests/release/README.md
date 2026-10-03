# Release safeguards — synthetic only

These tests are preparation, not deployment authorization. No production API, database,
account, backup payload or photo is accessed by CI. Workflow permissions remain read-only;
checkout fetches history only to reconstruct the exact old source commit.

`observed-backup-structure.sql` contains schema/function definitions read on 2026-10-02,
not business rows. It includes the current v3 capture function, compaction function,
backup table/indexes/RLS/ACL, daily/monthly job definitions, the observed dispatch trigger
and price RPC grant. Function definition hashes and job commands match the read-only
observation. Native upgrade CI installs this fixture **only into its new local Docker DB**,
compares it byte-for-byte before/after the incremental upgrade, preserves a synthetic
snapshot sentinel, and calls capture/compact only on synthetic data. Test schedules and
rows are removed afterwards. The offline test uses a cron contract double; it does not
prove native scheduler execution or disaster recovery.

`rollback.mjs` reconstructs application source from
`665a3efeab078c3cb838796b349f65f9edb5b322`. Pages deployment run `35568472588` reported that
commit successfully deployed. The original artifact `10625561131` returns 404 and the
published site could not be downloaded in this workspace (403). **This reconstruction is
not the original Jekyll artifact and is not proof of byte-identical hosted assets.**
The saved shipments v2 source was read from the deployed function and matched SHA-256
`d91b7e3db7ec4e48c3eebff4f25252ac24412434c2592b31d65f99e0ca7da489`.

The old pages run unchanged except the test server replaces their config module with
loopback settings; all other external requests are blocked or served from the locked SDK.
The old Edge source is served under a local `shipments-legacy` slug with JWT verification;
the test browser and verification calls map only the local shipments endpoint to it.
The same product/photo/price/intake/status/shipping/query flow runs on the upgraded schema.
No production endpoint is used and no schema is downgraded. Retained idempotency columns,
cleanup jobs, and data are not dropped as a rollback tactic.

Evidence boundaries: this proves the observed business-plus-backup boundary and old-code
compatibility when CI succeeds, not all platform extensions/Auth configuration, original
artifact recovery, live deployment switching, concurrent user writes, or full disaster
recovery. Existing Excel partial import and concurrent photo-replacement risks remain.
