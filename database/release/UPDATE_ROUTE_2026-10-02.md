# 更新入口唯讀核實（2026-10-02）

此報告不是執行部署的授權。核實起點為 PR #3 的
`c739d8c0e7a35c6c1ab7fdc1b77968e119451f90`，本機與遠端一致。
後續金額修正會改變候選；發布必須改用最後審核的 exact SHA。

## 實際查到什麼

- 官方 CLI 2.118.0 可執行；既有環境無可用 CLI token/DB 密碼/project link。
  `projects list` 唯讀實測回覆缺少登入。只檢查憑證是否存在，未輸出秘密值。
- 既有 Supabase MCP 的 `list_migrations`、`list_tables` 成功；不代表寫入核准恢復。
  沒有重試先前失效的 apply_migration requestState，也沒有登入、建立憑證或正式 SQL 執行。
- 正式 history 有 17 筆，最後為 `20260920081452_secure_vendor_price_history_rpc`。
  尚無 `20260930085010` 或 `20261002154901`。
- 表結構 metadata 確認 shipments/products 尚無新增 request 欄位，未列出新的 private
  清理／retirement 表。這不涵蓋函式、trigger、ACL、cron 或完整 schema 漂移。
- history 表主鍵為 text `version`；還有 nullable `statements text[]`、`name`、
  `created_by`、`idempotency_key`（unique）、`rollback text[]`。
  僅核對結構，沒有插入或修補 history。

## 實際可走的入口

**目前最短入口是專案擁有者既有登入的 Dashboard。** CLI 尚不能遠端 history/dry-run；
本輪不要求新增 token，不把 MCP OAuth 轉作 CLI 憑證。使用者下一步是先完成
[更新前方案](PRE_UPDATE_PLAN.md) 已列的備份目的地／版本核准關卡，再由已登入 Dashboard
的操作者執行經審核 SQL；不是現在按 Run，也不是藉 Dashboard 規避先前工具核准失效。
若重新選擇 CLI，先另行授權安全登入，再核實唯讀能力。

### 共同順序與停止條件

1. 重新核對 exact SHA、同 SHA 的 offline 與 fresh/upgrade/volume/recovery 綠燈；
   核准窗口及備份／恢復條件，核對正式 v3 備份函式／cron／ACL 漂移。
2. 只用 `database/upgrade/supabase/migrations` 下的兩個增量檔案，依序執行：
   - `20260930085010_upgrade_reconstructed_legacy_business.sql`
     SHA256 `c7fc6bb5643f6977740aa7eb273ddd4afeaffbab220e47bd6c49697a793bf362`
   - `20261002154901_guard_retired_requests_and_product_photos.sql`
     SHA256 `40197777d30ec745b4275e82d42da388c8ecce2e52a4a365909b60754e145172`
   每檔已有 BEGIN/COMMIT 與 5 秒 lock timeout。兩檔不是同一交易。
   不移除 preflight，不用 `IF NOT EXISTS` 掩蓋衝突，不重播 baseline 或舊備份 migration。
3. 每步實際成功後核對結構、權限與原資料，再核對 migration history。
   SQL Editor 的普通 SQL 執行**不自動**建立 CLI migration history。Dashboard-only 包須
   另行審核每一檔在 COMMIT 前加入正確 history 記錄的方式與 statements 內容，並隔離演練；
   目前原 SQL 檔不能被宣稱已具備這個記錄步驟。
   另一方式是在已核實成功後用另行授權 CLI `migration repair <version> --status applied`
   記錄兩個版本，再 `migration list` 比對；repair 是正式寫入，不是 rollback。
   **記錄不一致就停止，不先發布 Edge 或網頁。**
4. DB／history 成功後才更新 shipments、product-photos（保留 JWT/正式設定），再發布同 SHA
   網頁。新增照片 Edge 依賴第 2 筆 migration；新整元計價只處理後續新快照。
5. 完成唯讀核對及另行核准的 smoke，再恢復使用。沒有核准就不寫測試資料進正式庫。

### 若後續改走 CLI

不直接對 repo root 或 `database/rebuild` 執行 push。root 缺完整 business RPC bundle，
rebuild 是空庫重建；upgrade 目錄只有兩筆，而遠端還有 17 筆 history。
先建立隔離 release workdir，核對／準備 17 筆既有 history 對應檔及兩筆新檔；
歷史參考來源不等於正式現行 schema，不重播它們。
只在授權登入／project 核對後，才能規劃：

```sh
supabase migration list --project-ref icqdmzndjmxffnlciijs --workdir <reviewed-release-workdir>
supabase db push --dry-run --skip-vault --project-ref icqdmzndjmxffnlciijs --workdir <reviewed-release-workdir>
```

以上為未執行範本。實際 2.118.0 help 支援這些旗標；push 預設涉及 Vault 更新，因此明確
`--skip-vault`，不加 roles/seed/include-all、不自行 repair 舊 history。dry-run 必須只列兩個
待套版本（若最後候選新增 migration，重新審核）。多、少、missing history 或錯 project 皆停。
CLI 僅以 timestamp 比較 migration，不能把乾淨 dry-run 當作資料及 schema 全面相容證明。

## 失敗與退回

- 第一檔失敗：確認交易回滾，停止。第二檔失敗：只回滾第二檔，保留已成功第一檔，停止發布。
- 不直接刪新增 request／清理／retirement 狀態；history repair 不會還原資料。
- Edge/網頁失敗：依已保存的實際舊版本及相容演練回退；舊照片 Edge 不用 cleanup claim，
  不可盲目退回它而重新開啟併發刪圖風險。
- 整庫還原需同截點照片與截點後交易處理方案，不能用回退程式代替資料恢復。

目前仍缺正式副本目的地／恢復核實、完整 schema 漂移、最後 SHA 發布核准與可用正式寫入入口。
此輪沒有任何正式寫入、合併、部署、付費或憑證／workflow 權限變動。

官方依據：
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/reference/cli/supabase-migration-list
- https://supabase.com/docs/reference/cli/supabase-db-push
- https://supabase.com/docs/reference/cli/supabase-migration-repair
