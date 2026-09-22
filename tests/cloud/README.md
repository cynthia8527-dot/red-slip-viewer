# 獨立雲端資料庫測試

唯一允許的雲端測試專案是 `factory-board-test`（`zfcsuxihpakrsohvcwlr`）。主專案 `icqdmzndjmxffnlciijs` **不是測試目標**；不得在主專案執行本目錄任何 SQL。安裝測試標記前也先檢查只有測試專用圖片桶、沒有主環境圖片桶。所有可重跑的 Txxx.sql 都先讀 `test_guard.project_identity`，主專案沒有這個標記時會在寫入前失敗。每個情境自行建立合成資料，成功後刪除；若 `DO` 區塊失敗，該敘述整體回滾。

## 目前部署與限制

- 已在獨立測試專案重播 13 筆業務結構 migration，原文保存在 `../reference/main-migrations/`。測試部署把圖片桶名稱映射為 `factory-photos-test`。
- `observed_dispatch_locations.sql`、`observed_shipments_voided_by_index.sql` 是主專案現況存在、但歷史 migration 缺漏的結構重建；`test_project_guard.sql` 僅屬測試防呆。它們已部署到**測試專案**，不可當成已核准的主環境 migration。
- `enforce_confirmed_data_contracts.sql` 是本階段在**測試專案**套用的三項限制：廠商代碼＋簡稱唯一（兩筆空代碼也視為重複）、叫車名稱＋地址唯一、貨件照片路徑須屬於該貨件。執行前會核對測試專案標記與圖片桶，並檢查舊資料是否衝突；不會自動刪除或修正舊資料。它帶有測試專案專用防呆，**不是可直接套到主環境的 migration**。
- 測試專案已部署 `shipments` Edge Function，來源為 `../reference/edge-functions/shipments/index.ts`，只把永久刪除時使用的 `factory-photos` 桶映射為 `factory-photos-test`；建構規則在 `shipments-test-source.mjs`，T025 會拒絕主專案 ID 並檢查只有此一處差異。部署仍要求 JWT。測試專案未登入 GET 回 HTTP 401；另已用一次性帳號完成已登入的貨件／圖片 smoke（結果見 `AUTHENTICATED_SMOKE_2026-09-22.md`）。沒有對主環境函式發出測試請求，也沒有修改其部署。
- 主專案備份相關的 3 筆 migration 沒有部署到測試專案，以免建立排程或複製備份；早期公開讀取測試目錄的 migration 也未重播，因該政策不在主專案現況。
- 套用上述三項新限制**之前**，已比對 10 個業務表、32 個約束、37 條 RLS 政策及 28 個索引，測試專案與主專案原本現況相符（排除備份表；Storage 政策的 bucket ID 依環境不同）。目前測試專案因這三項限制而有意與主環境不同。
- 已登入 smoke 使用手動建立、測後登出並刪除的一次性帳號；**沒有**可長期、安全供命令列使用的測試憑證，因此目前**沒有** `npm run test:cloud`。不要把雲端情境算進 `npm run test` 的綠燈，也不要把主專案密鑰或服務角色金鑰放進 GitHub Actions。

## 執行方式與目前結果

目前透過已連接的 Supabase 工具，逐一對**明確指定的測試專案 ID**執行 Txxx.sql；若工具回報 SQL error 就記為 Failed，不可跳過或改成 Passed。這 8 個檔案可重跑：

| 情境 | 現況 | 範圍 |
|---|---|---|
| T008 | Passed | 修改廠商不改叫車地點 |
| T009 | Passed | 無效廠商／貨件外鍵被拒絕 |
| T010 | Passed | 相同「廠商代碼＋簡稱」及「叫車名稱＋地址」被拒絕；不同組合可並存，空代碼同簡稱也被拒絕 |
| T011 | Passed | 已存貨件快照不受後續價格列修改影響 |
| T012 | Passed（僅 SQL 層） | 單一資料庫交易失敗會回滾；已登入 Edge Function 的同一核心規則另測出失敗，見下方 |
| T018 | Passed | 從 SQL 呼叫真實 `replace_vendor_price` 函式，留舊價、關閉日期、拒絕重複換價；尚未驗證 REST 登入／RLS |
| T021 | Passed | 貨件照片新增或修改成另一貨件的路徑均被拒絕；正確路徑可新增 |
| T026 | Passed | 真實資料庫 RLS：管理員可新增、員工可讀但不能新增管理員資料、未核准者不可讀寫；使用無密碼的交易內假帳號，最後整筆回滾 |

另一次分階段 T019 驗證：先在舊結構放入合成價格 70，再套用價格歷史 migration，舊列仍為 70 且 `end_date` 為空。這是一次性的真實 migration 驗證，尚未做成可一鍵重建重跑的流程，**不得計入上表的 8 個可重跑情境**。

先前的 **5 Passed／2 Failed／0 Skipped** 揭露 T010、T021 衝突；在**測試專案**加入限制後，7 個資料情境全通過，再加入 T026 權限情境，目前可重跑 SQL 層為 **8 Passed／0 Failed／0 Skipped**。T009 的測試圖片路徑夾具同步改成符合新路徑格式，以便專注驗證外鍵拒絕；不是降低預期。T010、T021、T026 已各重跑兩次。主環境尚未套用限制，不能宣稱主環境也通過這兩項。

2026-09-22 的已登入一次性整合檢查另計為 **8 Passed／1 Failed／0 Skipped**，詳見 `AUTHENTICATED_SMOKE_2026-09-22.md`。失敗的是 T012／T017：無效貨件 POST 回 400，卻留下先建立的收貨群組。測後已清除這筆群組；貨件照片的真實 Storage 上傳、關聯與永久刪除則通過。這不是自動測試的綠燈，不應與上述 SQL 層數字合併。最後確認相關業務表、暫時帳號與測試圖片均為 0 筆。

主環境正式 migration 的前置檢查與未解決項見 `MAIN_MIGRATION_REVIEW.md`；這次沒有更動主環境。測試專案匿名登入維持關閉；T026 的交易內假使用者 RLS 測試與這次一次性 Auth／Edge／Storage smoke 各自記錄。下一步需先處理 T012／T017 的真實 API 規格衝突，再建立不依賴人工帳號且可安全重跑的雲端指令，並補齊主環境正式 migration 審核。Google Drive 備份還原仍依要求延後。
