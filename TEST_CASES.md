# 測試情境與隔離邊界（第一階段）

本文件把「不希望改壞的核心規則」與「尚未定案的功能」分開。`npm run test` 的通過只代表下表標示的**現有覆蓋層**通過，不代表未提交到此倉庫的 Supabase 資料庫、Edge Functions、備份系統已通過整合驗證。測試不得以 skipped 冒充 passed；完整指令遇到任何 skipped、失敗或無測試都會退出失敗。

## 環境與資料邊界

- 主環境專案 ID：`icqdmzndjmxffnlciijs`。只在 GitHub Pages 的既定主網域使用；主環境資料庫、`factory-photos` bucket 與備份完全不作測試目標。
- 本機測試網頁只接受 `localhost`／`127.0.0.1`／`[::1]` 的 Supabase URL，且必須提供與主環境不同的 `factory-photos-test` 等 bucket。`config.local.js` 未提供時網頁直接失敗，不回退主環境。
- 目前自動測試使用 `tests/fixtures/` 的合成資料、記憶體內 SQLite，以及只綁定回環位址的暫時網頁伺服器；每個資料測試重新建庫並在結束時關閉，瀏覽器測試結束時關閉瀏覽器與伺服器。沒有遠端資料、正式圖片、正式備份或雲端依賴。
- `tests/fixtures/schema.sql`、`legacy.sql`、`migration.sql` 是**合成契約夾具**，並非主 Supabase 的實際 schema／migration。真實 schema 和 Edge Functions 尚未在此倉庫，相關情境因此仍有整合測試缺口。
- 測試前置防呆會拒絕非回環的 `TEST_SUPABASE_URL`、`SUPABASE_URL`、`DATABASE_URL`、`POSTGRES_URL`，也會拒絕任何資料頁直接寫入主專案 ID。瀏覽器 smoke 只允許本機請求，Supabase JS 載入由測試替身攔截；意外遠端請求會使測試失敗。

## A. 已確認核心規則

| 編號 | 測試目的 | 前置條件 | 操作 | 預期結果 | 核心規則 | 自動測試位置／目前覆蓋層 |
|---|---|---|---|---|---|---|
| T001 | 測試端點不可連主環境 | 本機設定範例 | 驗證回環與遠端 URL | 僅回環通過，任何遠端拒絕 | 是 | `tests/config.test.mjs`；設定層 |
| T002 | 測試圖片不可使用主 bucket | 本機設定範例 | 改為主 bucket／缺 key | 設定被拒絕 | 是 | `tests/config.test.mjs`；設定層 |
| T003 | 本機未設定不得退回主環境 | 本機網址、缺設定 | 載入設定 | 明確錯誤，沒有主環境 fallback | 是 | `tests/config.test.mjs`；設定層 |
| T004 | 已發布頁面保留原有主設定 | 既定 GitHub Pages 網域 | 解析設定 | URL／bucket 維持既有值 | 是 | `tests/config.test.mjs`；設定層 |
| T005 | 日期價格不被新價提前或舊價覆蓋 | 合成兩期價格 | 查換價前後日期 | 各取當日有效價 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T006 | 價格歷史留舊價且不混廠商 | 同商品兩廠商、兩期價格 | 查旭呈歷史 | 50、70 都在，乙廠 90 不混入 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T007 | 不同廠商價格獨立 | 同商品兩廠商 | 查目前價格 | 兩廠商各保有正確單價 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T008 | 廠商與叫車資料互不污染 | 全新合成資料庫 | 修改廠商 | 叫車地點不變 | 是 | `tests/data.test.mjs`；離線關聯契約，待真實 schema 驗證 |
| T009 | 關聯資料與圖片不得錯位 | 全新合成資料庫、測試圖片 | 寫入不存在的廠商／貨件關聯 | 外鍵拒絕且圖片夾具存在 | 是 | `tests/data.test.mjs`；離線關聯契約，待真實 schema／Storage 驗證 |
| T010 | 重複操作不意外建立重複資料 | 全新合成資料庫 | 重複 operation key、同日同商品價 | 第二筆拒絕，數量不增加 | 是 | `tests/data.test.mjs`；離線唯一性契約，待真實 schema／API 驗證 |
| T011 | 貨件價格快照不隨改價變 | 全新合成資料庫 | 建貨件快照後改價格 | 貨件快照保留原價 | 是 | `tests/data.test.mjs`；離線契約，待 Edge Function 驗證 |
| T012 | 錯誤操作不留下半套資料 | 全新合成資料庫 | 同一交易先建商品、再寫無效價格 | 整筆回滾，商品不存在 | 是 | `tests/data.test.mjs`；離線交易契約，**目前前端流程未達此保證** |
| T013 | migration 後舊資料可讀 | 合成舊版資料 | 執行合成欄位新增 | 舊列保留且取得預設值 | 是 | `tests/data.test.mjs`；遷移模式示例，待真實 migration 驗證 |
| T014 | 四個資料頁不再寫死主 URL | 倉庫前端原始碼 | 檢查設定匯入 | 都經共用設定且無主 ID | 是 | `tests/smoke.test.mjs`＋`tests/run.mjs`；靜態防呆 |
| T015 | 基本入口未遺失 | 倉庫前端原始碼 | 檢查入口及共用函式 | 頁面及模組存在 | 是 | `tests/smoke.test.mjs`；靜態 smoke |
| T016 | 瀏覽器不發出主環境請求 | 本機伺服器、測試設定與假 Supabase client | 無登入開啟四個資料頁 | 頁面載入、無腳本錯誤、無外部資料請求 | 是 | `tests/browser.test.mjs`；本機瀏覽器 smoke，非完整 UI E2E |

## B. 待確認或待取得後端原始碼

| 編號 | 測試目的 | 前置條件 | 操作 | 預期結果 | 核心規則 | 自動測試位置 |
|---|---|---|---|---|---|---|
| T017 | 真實資料庫防重與交易性 | 獨立本機 Supabase、版本化 schema／Functions | 重送建立請求並注入中途錯誤 | 不重複、無半套資料 | 是，整合驗證待補 | 尚無；不得指向主環境 |
| T018 | 真實價格替換與出貨快照 | 獨立本機 Supabase、`replace_vendor_price`／`shipments` 原始碼 | 換價、出貨、再換價 | 歷史不覆蓋且快照不改 | 是，整合驗證待補 | 尚無；後端原始碼未入倉 |
| T019 | 真實 migration 舊資料相容 | 真實 baseline schema 與去識別測試樣本 | 對獨立測試庫跑 migration | 舊資料可讀、關聯完整 | 是，整合驗證待補 | 尚無；後端 migration 未入倉 |
| T020 | Google Drive 備份可還原 | 獨立測試雲端位置與測試備份 | 備份、刪除測試副本、還原 | 內容及 ID／關聯一致 | 是，延後 | 尚無；本階段不碰雲端備份 |
| T021 | 真實圖片上傳、關聯、清除 | 獨立本機 Storage bucket | 上傳／刪除測試圖片 | 路徑與資料關聯正確，不留下孤兒 | 是，整合驗證待補 | 尚無；目前僅測試 fixture／前端設定 |
| T022 | 介面位置、文字與流程 | 產品、貨件、叫車等 UI 規格定案 | 操作視覺細節 | 待產品決策 | 否，待確認 | 不寫死；目前僅 T016 smoke |

## 已發現的規格／現況衝突與風險

1. `board/` 的快速新增商品會先 insert `products` 再 insert `vendor_prices`，失敗時另做刪除補救；刪除若也失敗，可能留半套資料，與 T012 的核心規則衝突。這一階段依「先保留功能、最小修改」未改正式流程，T012 只測期望的離線交易契約，不宣稱現有流程已通過。
2. 本倉庫沒有可供驗證的真實主資料庫 schema、RLS、`replace_vendor_price`、`shipments` Edge Function、備份程式或 migration。T008–T013 的 SQLite 測試能防止測試規格及示例關聯退化，但不能證明遠端實作；T017–T021 是上線前必要的後續關卡。
3. 前端 `vendors`／`dispatch` 目前直接寫入資料表，是否有伺服端唯一鍵與冪等設計仍未知。不能把 T010 的離線成功視為正式 API 防重已完成。
4. 目前圖片上傳與資料列插入分兩步，失敗時有留下無關聯圖片的風險。此階段只抽離 bucket 設定，待 T021 設計獨立 Storage 整合測試並確認清理策略。

## 維護規則

純重構、效能優化、UI 排列調整：核心預期不改，測試應繼續通過。已確認業務規格正式變動：先更新本文件的相應情境及理由，再更新測試與實作；不可只為讓紅燈變綠而降低預期。schema 或 API 變動：新增版本化 migration 與舊資料相容測試。任何測試如果需要連遠端主 Supabase、主圖片 bucket、主備份或主雲端資料，應直接拒絕，而不是改成「暫時跳過」。
