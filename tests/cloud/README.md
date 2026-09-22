# 獨立雲端資料庫測試

唯一允許的雲端測試專案是 `factory-board-test`（`zfcsuxihpakrsohvcwlr`）。主專案 `icqdmzndjmxffnlciijs` **不是測試目標**；不得在主專案執行本目錄任何 SQL。安裝測試標記前也先檢查只有測試專用圖片桶、沒有主環境圖片桶。所有可重跑的 Txxx.sql 都先讀 `test_guard.project_identity`，主專案沒有這個標記時會在寫入前失敗。每個情境自行建立合成資料，成功後刪除；若 `DO` 區塊失敗，該敘述整體回滾。

## 目前部署與限制

- 已在獨立測試專案重播 13 筆業務結構 migration，原文保存在 `../reference/main-migrations/`。測試部署把圖片桶名稱映射為 `factory-photos-test`。
- `observed_dispatch_locations.sql`、`observed_shipments_voided_by_index.sql` 是主專案現況存在、但歷史 migration 缺漏的結構重建；`test_project_guard.sql` 僅屬測試防呆。它們已部署到**測試專案**，不可當成已核准的主環境 migration。
- `enforce_confirmed_data_contracts.sql` 是本階段在**測試專案**套用的三項限制：廠商代碼＋簡稱唯一（兩筆空代碼也視為重複）、叫車名稱＋地址唯一、貨件照片路徑須屬於該貨件。執行前會核對測試專案標記與圖片桶，並檢查舊資料是否衝突；不會自動刪除或修正舊資料。它帶有測試專案專用防呆，**不是可直接套到主環境的 migration**。
- 測試專案已部署 `shipments` Edge Function，來源為 `../../supabase/functions/shipments/index.ts`，只把永久刪除時使用的 `factory-photos` 桶映射為 `factory-photos-test`；建構規則在 `shipments-test-source.mjs`，T025 會拒絕主專案 ID 並檢查只有這一處環境差異。POST 先驗證必填欄位，再呼叫單一資料庫函式建立群組與貨件；部署仍要求 JWT。主環境函式**未部署此修正**。
- `create_shipment_atomic.sql` 已**只在測試專案**安裝：先核對專案標記和測試圖片桶，函式為 `security invoker`，且只授權 Edge Function 使用的 `service_role` 執行，不開放匿名或一般登入者直接呼叫。這是測試階段的 SQL，**不是可直接套到主環境的正式 migration**。
- 主專案備份相關的 3 筆 migration 沒有部署到測試專案，以免建立排程或複製備份；早期公開讀取測試目錄的 migration 也未重播，因該政策不在主專案現況。
- 套用上述三項新限制**之前**，已比對 10 個業務表、32 個約束、37 條 RLS 政策及 28 個索引，測試專案與主專案原本現況相符（排除備份表；Storage 政策的 bucket ID 依環境不同）。目前測試專案因這三項限制而有意與主環境不同。
- 已依使用者同意，在**測試專案**保留一個 `codex-cloud@example.invalid` 專用管理測試帳號。此電腦的 `credentials.local.json` 被 git 忽略，密碼由目前 Windows 使用者的 DPAPI 加密；它不能在另一台電腦或其他 Windows 使用者下直接解密。沒有服務角色金鑰，亦沒有把密碼或本機憑證提交到 GitHub。
- 固定指令 `npm run test:cloud` 只對寫死的測試專案 URL 登入，執行「缺必填欄位、正常建立、群組建立後貨件 insert 故意失敗」三種 POST 情境，檢查關聯與回滾，清除它自己建立的群組／貨件並全域登出。缺本機測試憑證會**失敗，不會 skipped**。它不包含 Google Drive、完整 UI、PATCH 換群組或所有資料關聯；不得把它算進離線 `npm run test` 的綠燈，也不得把主專案金鑰放進 GitHub Actions。

## 執行方式與目前結果

目前透過已連接的 Supabase 工具，逐一對**明確指定的測試專案 ID**執行 Txxx.sql；若工具回報 SQL error 就記為 Failed，不可跳過或改成 Passed。這 8 個檔案可重跑：

| 情境 | 現況 | 範圍 |
|---|---|---|
| T008 | Passed | 修改廠商不改叫車地點 |
| T009 | Passed | 無效廠商／貨件外鍵被拒絕 |
| T010 | Passed | 相同「廠商代碼＋簡稱」及「叫車名稱＋地址」被拒絕；不同組合可並存，空代碼同簡稱也被拒絕 |
| T011 | Passed | 已存貨件快照不受後續價格列修改影響 |
| T012 | Passed（此 SQL 情境） | 單一資料庫交易失敗會回滾；新增貨件 API 的三種情境另由 `npm run test:cloud` 驗證，整體 T012 仍有未覆蓋流程 |
| T018 | Passed | 從 SQL 呼叫真實 `replace_vendor_price` 函式，留舊價、關閉日期、拒絕重複換價；尚未驗證 REST 登入／RLS |
| T021 | Passed | 貨件照片新增或修改成另一貨件的路徑均被拒絕；正確路徑可新增 |
| T026 | Passed | 真實資料庫 RLS：管理員可新增、員工可讀但不能新增管理員資料、未核准者不可讀寫；使用無密碼的交易內假帳號，最後整筆回滾 |

另一次分階段 T019 驗證：先在舊結構放入合成價格 70，再套用價格歷史 migration，舊列仍為 70 且 `end_date` 為空。這是一次性的真實 migration 驗證，尚未做成可一鍵重建重跑的流程，**不得計入上表的 8 個可重跑情境**。

先前的 **5 Passed／2 Failed／0 Skipped** 揭露 T010、T021 衝突；在**測試專案**加入限制後，7 個資料情境全通過，再加入 T026 權限情境，目前可重跑 SQL 層為 **8 Passed／0 Failed／0 Skipped**。T009 的測試圖片路徑夾具同步改成符合新路徑格式，以便專注驗證外鍵拒絕；不是降低預期。T010、T021、T026 已各重跑兩次。主環境尚未套用限制，不能宣稱主環境也通過這兩項。

2026-09-22 的已登入一次性整合檢查另計為 **8 Passed／1 Failed／0 Skipped**，詳見 `AUTHENTICATED_SMOKE_2026-09-22.md`。失敗的是 T012／T017：無效貨件 POST 回 400，卻留下先建立的收貨群組。測後已清除這筆群組；貨件照片的真實 Storage 上傳、關聯與永久刪除則通過。這不是自動測試的綠燈，不應與上述 SQL 層數字合併。最後確認相關業務表、暫時帳號與測試圖片均為 0 筆。

先前只修改 POST 驗證順序後，`npm run test:cloud` 對「缺商品名稱仍建立群組」案例通過，但這不保證第二步寫入失敗會回滾。因此再把**測試專案的新增貨件 POST** 改為單一資料庫函式。首次擴充雲端測試時，故意讓第二步失敗得到 HTTP 500，但函式的錯誤回應只有 `[object Object]`，無法確認失敗位置，故**整次指令記為 Failed**，未當成綠燈。補上正常建立的對照情境後，確認相同輸入只改成無效地點會在貨件插入時失敗，而群組與貨件都留下 0 筆。最近連續兩次固定指令結果均為 **3 Passed／0 Failed／0 Skipped**，且測試資料與工作階段均清除；專用帳號保留。

主環境正式 migration 的前置檢查與未解決項見 `MAIN_MIGRATION_REVIEW.md`；這次沒有更動主環境。測試專案匿名登入維持關閉；T026 的交易內假使用者 RLS 測試與已登入 Auth／Edge／Storage smoke 各自記錄。下一步仍需處理 PATCH 換群組、前端快速新增的多步寫入，補 API 重送防重與更完整的已登入測試，並審核主環境正式 migration。Google Drive 備份還原仍依要求延後。
