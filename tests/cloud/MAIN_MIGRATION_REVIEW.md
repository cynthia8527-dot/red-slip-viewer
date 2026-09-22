# 主環境資料限制更新：部署前審核清單

此檔只記錄審核條件，**不是可執行 migration**。主 Supabase 專案 `icqdmzndjmxffnlciijs` 目前未套用本階段的三項限制，也沒有貨件新增／換群組與快速新增商品交易函式；不得對主專案執行 `tests/cloud/Txxx.sql`、`enforce_confirmed_data_contracts.sql`、`create_shipment_atomic.sql`、`update_shipment_atomic.sql` 或 `create_product_with_initial_price.sql` 這些測試專案專用 SQL。

## 已確認的規則

1. `vendors`：`code`＋`short_name` 相同時不可建立第二筆。`code` 可為空，兩筆空代碼且簡稱相同也算重複；單一欄相同、另一欄不同則可並存。
2. `dispatch_locations`：`name`＋`address` 相同時不可建立第二筆；單一欄相同、另一欄不同則可並存。
3. `shipment_photos`：`storage_path` 必須以 `shipments/<shipment_id>/` 開頭，且後面要有檔名；新增和修改都需檢查。這只保護資料列的路徑關聯，不保證 Storage 實體檔案存在或刪除完整。

## 部署前必做

- 再次唯讀檢查主環境是否已有重複組合或錯位路徑；若有，先人工判定每筆如何處理，不能讓 migration 自動刪除或覆蓋資料。2026-09-22 的盤點結果是三項衝突群組／列均為 0，但部署當天必須重查。
- 釐清主專案歷史 migration 缺漏的 `dispatch_locations` 建表紀錄，建立可從零重建的版本化 baseline。此倉庫現在只有主專案歷史 SQL 快照，不能直接拿 `supabase db reset` 當正式相容性驗證。
- 使用 Supabase CLI 的 `migration new` 建立正式 migration 檔，檢查差異與套用順序；不要手寫猜測時間戳，也不要把帶測試專案標記／測試圖片桶的 SQL 原樣套到主環境。本工作機目前沒有 Supabase CLI 或 `psql`，所以尚未建立或套用正式 migration。
- 若之後決定把貨件新增／換群組原子性修正部署到主環境，須先產生正式且不含測試專案防呆的兩個函式 migration，核對 `security invoker` 與僅 `service_role` 可執行，再部署依賴它們的 Edge Function；不可先部署新 Edge Function，否則新增／換群組會因找不到 RPC 而失敗。
- 快速新增商品另需正式函式 migration，保留 `security invoker`、管理員檢查及既有商品／價格 RLS；先部署函式、再發佈依賴它的 `board/` 網頁，否則按「新增商品」會失敗。測試專案的 SQL 含專案標記，不能原樣複製到主環境。
- 貨件重送防重須建立獨立、版本化 migration：先對 `shipments` 新增可空的 request ID／fingerprint（舊列保持 `NULL`，不回填、不改既有 ID），部署唯一索引、成對檢查與新的 `create_shipment_idempotent` 函式；不要覆蓋目前三參數函式。部署前以合成舊資料驗證舊貨件仍可讀、舊 Edge Function 仍可呼叫原函式。資料庫審核通過後才部署呼叫新 RPC 的 Edge Function，最後才部署送出並保存 `Idempotency-Key` 的網頁。
- 上述舊呼叫相容性已由測試專案的 `T029.sql` 連跑兩次驗證：舊三參數建立與既有修改 RPC 均可讀寫同一貨件，新增防重欄位保持 `NULL`，測後無殘留。這只證明目前候選結構與舊 RPC 相容；正式 migration 仍須從主環境部署前快照重建後再跑一次。
- 防重 migration 正式化前，先在測試專案執行 `T028.sql` 並做已登入 API 重送：第一次請求的回應由測試端故意丟棄，再以相同 key／內容重送，確認只存在一筆貨件及一筆群組；同 key 改內容須回 409。`tests/cloud/create_shipment_idempotent.sql` 含測試標記，只是候選，不得原樣套到主環境。
- `board/` 的照片資料列已改由 Edge Function 建立並在失敗時清除本次 Storage 物件；正式部署時必須先部署含 `attach_photo` 的 Edge Function，再發布呼叫它的網頁。若順序顛倒，照片會先上傳但關聯請求失敗，反而製造孤兒檔。此流程跨 Storage／資料庫，仍須在測試專案用已登入身分驗證失敗清理，不能稱為單一交易。
- 先在獨立測試專案用合成舊資料重跑 migration 相容性，確認只新增限制、沒有變更既有欄位或刪除資料；失敗時保留錯誤與差異，不改低測試預期。
- 正式變更須有部署窗口與可回復的事前備份；套用後對主環境只做唯讀結構與衝突數量核對，**不執行 Txxx 測試、不建立合成資料**。

目前已在獨立測試專案套用對應的三項限制，T010、T021 可重跑且通過。這不等於主環境已更新，也不等於貨件 Edge Function、Storage 上傳與清理都已整合驗證。
