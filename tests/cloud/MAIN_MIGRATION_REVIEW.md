# 主環境資料限制更新：部署前審核清單

此檔只記錄審核條件，**不是可執行 migration**。主 Supabase 專案 `icqdmzndjmxffnlciijs` 目前未套用本階段的三項限制；不得對主專案執行 `tests/cloud/Txxx.sql` 或測試專案專用的 `enforce_confirmed_data_contracts.sql`。

## 已確認的規則

1. `vendors`：`code`＋`short_name` 相同時不可建立第二筆。`code` 可為空，兩筆空代碼且簡稱相同也算重複；單一欄相同、另一欄不同則可並存。
2. `dispatch_locations`：`name`＋`address` 相同時不可建立第二筆；單一欄相同、另一欄不同則可並存。
3. `shipment_photos`：`storage_path` 必須以 `shipments/<shipment_id>/` 開頭，且後面要有檔名；新增和修改都需檢查。這只保護資料列的路徑關聯，不保證 Storage 實體檔案存在或刪除完整。

## 部署前必做

- 再次唯讀檢查主環境是否已有重複組合或錯位路徑；若有，先人工判定每筆如何處理，不能讓 migration 自動刪除或覆蓋資料。2026-09-22 的盤點結果是三項衝突群組／列均為 0，但部署當天必須重查。
- 釐清主專案歷史 migration 缺漏的 `dispatch_locations` 建表紀錄，建立可從零重建的版本化 baseline。此倉庫現在只有主專案歷史 SQL 快照，不能直接拿 `supabase db reset` 當正式相容性驗證。
- 使用 Supabase CLI 的 `migration new` 建立正式 migration 檔，檢查差異與套用順序；不要手寫猜測時間戳，也不要把帶測試專案標記／測試圖片桶的 SQL 原樣套到主環境。本工作機目前沒有 Supabase CLI 或 `psql`，所以尚未建立或套用正式 migration。
- 先在獨立測試專案用合成舊資料重跑 migration 相容性，確認只新增限制、沒有變更既有欄位或刪除資料；失敗時保留錯誤與差異，不改低測試預期。
- 正式變更須有部署窗口與可回復的事前備份；套用後對主環境只做唯讀結構與衝突數量核對，**不執行 Txxx 測試、不建立合成資料**。

目前已在獨立測試專案套用對應的三項限制，T010、T021 可重跑且通過。這不等於主環境已更新，也不等於貨件 Edge Function、Storage 上傳與清理都已整合驗證。
