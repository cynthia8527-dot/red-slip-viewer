# 獨立雲端資料庫測試

唯一允許的雲端測試專案是 `factory-board-test`（`zfcsuxihpakrsohvcwlr`）。主專案 `icqdmzndjmxffnlciijs` **不是測試目標**；不得在主專案執行本目錄任何 SQL。安裝測試標記前也先檢查只有測試專用圖片桶、沒有主環境圖片桶。所有可重跑的 Txxx.sql 都先讀 `test_guard.project_identity`，主專案沒有這個標記時會在寫入前失敗。每個情境自行建立合成資料，成功後刪除；若 `DO` 區塊失敗，該敘述整體回滾。

## 目前部署與限制

- 已在獨立測試專案重播 13 筆業務結構 migration，原文保存在 `../reference/main-migrations/`。測試部署把圖片桶名稱映射為 `factory-photos-test`。
- `observed_dispatch_locations.sql`、`observed_shipments_voided_by_index.sql` 是主專案現況存在、但歷史 migration 缺漏的結構重建；`test_project_guard.sql` 僅屬測試防呆。它們已部署到**測試專案**，不可當成已核准的主環境 migration。
- `enforce_confirmed_data_contracts.sql` 是本階段在**測試專案**套用的三項限制：廠商代碼＋簡稱唯一（兩筆空代碼也視為重複）、叫車名稱＋地址唯一、貨件照片路徑須屬於該貨件。執行前會核對測試專案標記與圖片桶，並檢查舊資料是否衝突；不會自動刪除或修正舊資料。它帶有測試專案專用防呆，**不是可直接套到主環境的 migration**。
- 測試專案已部署 `shipments` Edge Function，來源為 `../reference/edge-functions/shipments/index.ts`，只把永久刪除時使用的 `factory-photos` 桶映射為 `factory-photos-test`；建構規則在 `shipments-test-source.mjs`，T025 會拒絕主專案 ID 並檢查只有此一處差異。部署仍要求 JWT。已對測試專案執行一次不帶憑證的 GET，得到 HTTP 401；沒有對主環境函式發出測試請求，也沒有修改其部署。
- 主專案備份相關的 3 筆 migration 沒有部署到測試專案，以免建立排程或複製備份；早期公開讀取測試目錄的 migration 也未重播，因該政策不在主專案現況。
- 套用上述三項新限制**之前**，已比對 10 個業務表、32 個約束、37 條 RLS 政策及 28 個索引，測試專案與主專案原本現況相符（排除備份表；Storage 政策的 bucket ID 依環境不同）。目前測試專案因這三項限制而有意與主環境不同。
- 尚未取得只限測試專案、可供命令列安全使用的憑證，因此目前**沒有** `npm run test:cloud`。不要把雲端情境算進 `npm run test` 的綠燈，也不要把主專案密鑰或服務角色金鑰放進 GitHub Actions。

## 執行方式與目前結果

目前透過已連接的 Supabase 工具，逐一對**明確指定的測試專案 ID**執行 Txxx.sql；若工具回報 SQL error 就記為 Failed，不可跳過或改成 Passed。這 7 個檔案可重跑：

| 情境 | 現況 | 範圍 |
|---|---|---|
| T008 | Passed | 修改廠商不改叫車地點 |
| T009 | Passed | 無效廠商／貨件外鍵被拒絕 |
| T010 | Passed | 相同「廠商代碼＋簡稱」及「叫車名稱＋地址」被拒絕；不同組合可並存，空代碼同簡稱也被拒絕 |
| T011 | Passed | 已存貨件快照不受後續價格列修改影響 |
| T012 | Passed | 單一資料庫交易失敗會回滾；不代表前端快速新增已原子化 |
| T018 | Passed | 從 SQL 呼叫真實 `replace_vendor_price` 函式，留舊價、關閉日期、拒絕重複換價；尚未驗證 REST 登入／RLS |
| T021 | Passed | 貨件照片新增或修改成另一貨件的路徑均被拒絕；正確路徑可新增 |

另一次分階段 T019 驗證：先在舊結構放入合成價格 70，再套用價格歷史 migration，舊列仍為 70 且 `end_date` 為空。這是一次性的真實 migration 驗證，尚未做成可一鍵重建重跑的流程，**不得計入上表的 7 個可重跑情境**。

先前的 **5 Passed／2 Failed／0 Skipped** 揭露 T010、T021 衝突；在**測試專案**加入限制後，最近一次為 **7 Passed／0 Failed／0 Skipped**。T009 的測試圖片路徑夾具同步改成符合新路徑格式，以便專注驗證外鍵拒絕；不是降低預期。T010、T021 已各重跑兩次。最後確認廠商、叫車、商品、價格、貨件、貨件照片、臨時測試帳號與測試圖片均為 0 筆。主環境尚未套用限制，不能宣稱主環境也通過這兩項。

主環境正式 migration 的前置檢查與未解決項見 `MAIN_MIGRATION_REVIEW.md`；這次沒有更動主環境。下一步仍需安全的測試專用身分／憑證、固定雲端指令、已登入的貨件函式操作，以及真實 Storage 上傳與清理測試。Google Drive 備份還原仍依要求延後。
