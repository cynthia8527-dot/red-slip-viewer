# 版本化 migration 候選

這個目錄目前只有「防重欄位與限制」增量候選，不是完整 baseline，也不是部署核准。PR #3 維持 Draft；不得因本機測試通過就執行主環境 `db push`、合併或發布依賴新函式的網頁／Edge Function。

`20260930040920_add_idempotency_request_columns.sql` 由固定版本 CLI 產生檔名：

```sh
npm exec --yes --package=supabase@2.118.0 -- supabase migration new add_idempotency_request_columns
```

候選只對既有 `shipments`／`products` 加入可空 request UUID、fingerprint、成對檢查及部分唯一索引；舊列保留兩欄 NULL，不回填、不刪資料、不改 RLS／授權。UUID 非空時 fingerprint 必須非空且為 64 位小寫十六進位，避免 PostgreSQL CHECK 遇 NULL 時放行。整份 SQL 包在交易內，鎖等待上限五秒；已有同名欄位或索引會失敗，讓結構差異先接受審核。

`npm run test` 使用固定版本 PGlite，在記憶體 PostgreSQL 的合成舊表上實際執行候選原文，確認舊 ID／70 元快照保留、舊式更新可用、缺半邊與不合法 fingerprint 被拒絕、重複 UUID 被拒絕，以及第二個表衝突時第一個表變更也回滾。合成表不是主環境完整結構；這不覆蓋 Supabase Auth／RLS、RPC 正式 migration、多連線並發、所有歷史 migration 或主環境部署。

部署前仍須：補完整 baseline → 審核並完成所有所需 RPC migration → 在隔離環境從部署前結構演練舊資料／舊呼叫相容 → 執行有安全憑證的測試專案 API → 向使用者明確說明風險、備份與回復步驟並取得部署授權 → 先資料庫，後 Edge Function，再網頁。此欄位候選單獨套用並不能讓新 RPC 可用。
