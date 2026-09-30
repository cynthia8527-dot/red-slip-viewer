# 2026-09-30 防重邊界與 migration 演練紀錄

PR #3 維持 Draft，沒有合併、發布網頁或部署主 Supabase。主專案連線／寫入／圖片上傳／SQL 套用均為 0。

## 發現與修正

1. 貨件 RPC 原本以 `fingerprint !~ regex` 判斷格式，遇 NULL 不進入拒絕分支；成對 CHECK 也可能得到 UNKNOWN 而放行。本機 PostgreSQL 及恢復後的測試資料庫都重現 NULL 被接受。候選 SQL 加入明確非空判斷，並將限制重建與函式安裝包在同一交易。已只對 `zfcsuxihpakrsohvcwlr` 套用帶專案 guard 的修正。沒有部署 Edge Function。
2. `board/` 快速新增商品的生效日期自動取今天；回應遺失後跨台北午夜、重新整理重填時，原本會換日期及 UUID。Chromium 固定時間重現後，草稿網頁修正為相同表單沿用待確認請求的原日期及完整 body。實際改單價仍產生新 UUID；`calculator/` 明確輸入的日期不改。主環境未發布。
3. 使用 Supabase CLI 2.118.0 的 `migration new` 建立版本化欄位／限制候選。在 PGlite 記憶體 PostgreSQL 執行原文，以合成舊表驗證舊 ID／70 元快照、舊式更新、成對檢查／唯一性及第二表衝突時整筆回滾。候選不含 RPC、完整 baseline 或 RLS 重播，不能部署。

## 實際執行結果（各列分開計數）

| 執行 | Passed | Failed | Skipped | 說明 |
|---|---:|---:|---:|---|
| 本機 PostgreSQL 首次紅燈 | 1 | 2 | 0 | NULL fingerprint 被接受；新欄位 migration 演練先通過 |
| Chromium 跨午夜首次紅燈 | 0 | 1 | 0 | 日期與 UUID 都改變 |
| 測試專案 T028 修正前 | 0 | 1 | 0 | NULL 被接受；單一 DO 失敗整筆回滾 |
| 測試專案 T028 修正後第一輪 | 1 | 0 | 0 | 拒絕 NULL／不合法 fingerprint、成對檢查與正常重送 |
| 測試專案 T028 修正後第二輪 | 1 | 0 | 0 | 可重跑；不增加下列情境總數 |
| 最終 `npm run test` | 66 | 0 | 0 | Chromium 全套、本機 PostgreSQL 四項與其他離線測試 |
| GitHub CI #80 | 66 | 0 | 0 | 回讀 log 的 TEST RUN PASS，main Supabase connections=0 |
| 測試專案完整 SQL 重跑 | 14 | 0 | 0 | 本輪實際重跑，不是沿用先前結果 |

14 個 SQL 情境為 T008、T009、T010、T011、T012、T018、T019_legacy_writes、T021、T026、T027、T028、T029、T030、T031。每個檔案都明確指定測試專案並核對 guard，依序執行。

初始情境請求與唯讀標記查詢均因資料庫連線逾時未取得結果；查到測試專案 INACTIVE 後恢復，確認 ACTIVE_HEALTHY 才進行上述 SQL。恢復不等於任何測試通過。需要真正 Auth 登入的 11 項主 runner、3 項商品照片、4 項貨件照片仍缺安全 DPAPI 憑證，未執行，不列 Passed 或 Skipped；沒有要求在對話提供密碼。

## 測後核對

測試專案全表貨件、群組、商品、價格、貨件照片及 `private.shipment_deletion_jobs` 均為 0；T026／T027／T031／T018 的交易內測試帳號與 `auth.sessions` 均為 0。專用登入帳號保留。本輪沒有上傳 Storage 圖片。

函式回讀顯示 `prosecdef=false`；`anon`／`authenticated` 的 EXECUTE 為 false，`service_role` 為 true。沒有放寬權限。

測試專案 advisors 回報 `allowed_emails` 無 RLS policy 的 INFO、[外洩密碼保護未啟用](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) WARN，以及 15 個 [unused_index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) INFO；本輪沒有新增 RLS／security-definer 警告或移除既有索引，也沒有擴改 Auth 設定。

仍待完成：完整 baseline／正式 RPC migration、真實登入 API／Storage 整合、商品照片併發清理與持久孤兒清理、Excel 匯入契約。正式部署順序仍須先審核資料庫，再 Edge Function，最後網頁；部署或合併前先告知使用者風險與步驟。Google Drive 實際備份／還原繼續延後。
