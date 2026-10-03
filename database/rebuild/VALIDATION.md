# 2026-09-30 空庫重建驗證

測試基準為 `470d8fe937da95eb5349dfbcb9ec2979c77477cd` 加本輪未提交的重建候選／測試。遠端 PR #3 head 未前進；沒有 commit、push、merge 或任何遠端部署。

| 實跑 | 結果 |
|---|---|
| CLI 2.118.0 `migration new` 三次 | 已產生三個 20260930075150／151／152 檔名 |
| `docker pull postgres:17` | **基礎設施阻擋**：registry-1.docker.io `/v2/` 回 Forbidden；容器空庫／完整 Supabase 平台重播未開始 |
| 初版 `npm run test:rebuild` | Node 計數 17 pass／2 fail（T031 一個子測試失敗及其父群組失敗）；三份 SQL 均完成，但呼叫商品防重 RPC 得到 SQLSTATE 3F000：schema "extensions" does not exist |
| 補明 pgcrypto schema 後 `node tests/rebuild/replay.mjs` | 三份候選原文全部順序成功 |
| `npm run test:rebuild` | **19 pass／0 fail／0 skipped**，含 14 個既有 SQL 情境，以及來源、schema／權限、拒絕誤套與零殘留核對；父群組包含在 Node 計數內 |
| `TEST_BROWSER_PATH=/usr/bin/chromium npm run test` | **91 pass／0 fail／0 skipped**，包含上述重建測試，主 Supabase 連線 0；不是 91 再加 19 |
| `node tests/reference/migration-inventory.mjs` | 仍為退出碼 **2**，原始 17 份歷史確實仍缺兩項定義；不修改歷史來讓指標轉綠 |

重建為每輪新開的 PGlite 0.5.8 PostgreSQL 記憶體資料庫；關閉即丟棄。業務 DDL、pgcrypto、函式、交易、資料限制、索引、真實 PostgreSQL 角色與 RLS 都有執行。Auth／Storage 平台物件為明列介面替身，不能稱完整 Supabase 重建完成，也不能據此套用正式 DB。

測後 public／private 業務表、auth 假帳號、Storage 物件全部零列；測試 guard／bucket 設定只存在於隨即關閉的本地記憶體庫。既有遠端 test 僅做系統 catalog 唯讀查詢，正式站未連線，沒有改任何真實 schema／資料／帳密／權限。

目前補齊：叫車地點表及其 RLS／grants、貨件作廢人索引、空庫必需的 pgcrypto schema；並將分散的業務合約／RPC 收入可順序重播的候選。仍缺完整 Supabase 官方平台堆疊、備份排程／網路服務（有意排除）、正式既有資料升級及歷史接軌、完整平台登入 API／UI 與多連線驗證。需要具備可用官方 image 的獨立拋棄式環境進行下一階段；不得借用／重置既有測試站或正式站補作。
