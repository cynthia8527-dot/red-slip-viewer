# 獨立雲端資料庫測試

唯一允許的雲端測試專案是 `factory-board-test`（`zfcsuxihpakrsohvcwlr`）。主專案 `icqdmzndjmxffnlciijs` **不是測試目標**；不得在主專案執行本目錄任何 SQL。安裝測試標記前也先檢查只有測試專用圖片桶、沒有主環境圖片桶。所有可重跑的 Txxx.sql 都先讀 `test_guard.project_identity`，主專案沒有這個標記時會在寫入前失敗。每個情境自行建立合成資料，成功後刪除；若 `DO` 區塊失敗，該敘述整體回滾。

## 目前部署與限制

- 已在獨立測試專案重播 13 筆業務結構 migration，原文保存在 `../reference/main-migrations/`。測試部署把圖片桶名稱映射為 `factory-photos-test`。
- `observed_dispatch_locations.sql`、`observed_shipments_voided_by_index.sql` 是主專案現況存在、但歷史 migration 缺漏的結構重建；`test_project_guard.sql` 僅屬測試防呆。它們已部署到**測試專案**，不可當成已核准的主環境 migration。
- `enforce_confirmed_data_contracts.sql` 是本階段在**測試專案**套用的三項限制：廠商代碼＋簡稱唯一（兩筆空代碼也視為重複）、叫車名稱＋地址唯一、貨件照片路徑須屬於該貨件。執行前會核對測試專案標記與圖片桶，並檢查舊資料是否衝突；不會自動刪除或修正舊資料。它帶有測試專案專用防呆，**不是可直接套到主環境的 migration**。
- 測試專案已部署 `shipments` Edge Function v9，來源為 `../../supabase/functions/shipments/index.ts`，只把所有 `factory-photos` Storage 呼叫映射為 `factory-photos-test`；建構規則在 `shipments-test-source.mjs`，T025 會拒絕主專案 ID 並核對替換次數。POST 先驗證必填欄位，再呼叫單一資料庫函式建立群組與貨件；換群組的 PATCH 也由單一資料庫函式完成。照片上傳後改由此函式確認物件存在並建立資料列，資料列失敗時以服務權限刪除本次物件；相同路徑重送會回傳原關聯，前端網路層無回應時重試一次。草稿 `board/` 現在上傳前儲存同帳號分頁待辦，重新整理沿用同一路徑補關聯；物件暫未出現時保留兩分鐘，超時或關閉分頁仍可能留下孤兒圖。離線瀏覽器 smoke 已加入全程本機攔截的逾時與重新整理演練；不算已登入測試專案整合。永久刪除會先以資料庫交易保存 Storage 路徑並刪除關聯資料，再清 Storage 及記錄結果。部署仍要求 JWT。主環境函式**未部署此修正**。
- 測試專案已部署獨立 `product-photos` Edge Function v3，來源為 `../../supabase/functions/product-photos/index.ts`；`product-photos-test-source.mjs` 只允許測試專案並把桶映射為 `factory-photos-test`。函式要求 JWT，再以真實使用者查啟用中的管理員 profile；同一路徑重送不重複更新，關聯失敗清除新物件，換圖後舊物件清理失敗可重送。舊圖清理前重讀商品路徑，若舊圖已重新成為現用圖則保留待辦，不回報新圖已確定套用；重讀與刪除間仍可能競速。回讀部署內容確認 `verify_jwt=true` 且只使用測試桶。主環境未部署，草稿網頁不可先發布。
- `create_shipment_atomic.sql` 與 `update_shipment_atomic.sql` 已**只在測試專案**安裝：先核對專案標記和測試圖片桶，函式為 `security invoker`，且只授權 Edge Function 使用的 `service_role` 執行，不開放匿名或一般登入者直接呼叫。這是測試階段的 SQL，**不是可直接套到主環境的正式 migration**。
- `create_product_with_initial_price.sql` 也只在**測試專案**安裝，先核對標記與測試圖片桶；網頁以一般登入者身分呼叫，函式以 `security invoker` 執行，內部檢查管理員，仍受商品及價格的 RLS 政策限制。匿名使用者不能執行。它也是測試階段 SQL，**不是主環境 migration**；草稿分支的 `board/` 快速新增改用此 RPC，不能在主環境缺少正式函式時直接發佈。
- `create_product_with_initial_price_idempotent.sql` 已只在**測試專案**安裝：新增可空的 request UUID／fingerprint 與獨立 RPC，不覆蓋舊函式；同 key 以交易鎖序列化，相同內容回傳原商品，改內容回 409。RPC 接受並保存獨立的廠商製程與價格備註，供 `board/` 與 `calculator/` 共用。函式仍為 `security invoker` 且只授權 `authenticated`，內部保留管理員檢查。它不是正式 migration，主環境未安裝。
- `create_shipment_idempotent.sql` 已只在**測試專案**安裝：新增可空的 request ID／fingerprint 欄位與另一個 RPC，不覆蓋舊三參數函式。相同 request ID 會先取得交易級鎖；同內容回傳第一次結果，不同內容拒絕。測試專案 `shipments` Edge Function 已更新為 v9、仍要求 JWT；主環境未安裝或部署。
- `delete_shipment_with_cleanup_job.sql` 已只在**測試專案**安裝：以單一交易把圖片路徑存入私有清理工作並刪除貨件／照片，Storage 清理結果另行記錄；同一貨件 ID 可重送。函式為 `security invoker`，表與 RPC 只授權 `service_role`。測試專案 Edge v9 已部署此流程，但因本環境無安全登入憑證尚未做登入整合；主環境未安裝或部署。
- 主專案備份相關的 3 筆 migration 沒有部署到測試專案，以免建立排程或複製備份；早期公開讀取測試目錄的 migration 也未重播，因該政策不在主專案現況。
- `node tests/reference/migration-inventory.mjs` 是純離線的歷史檔案盤點。17 筆快照仍缺叫車地點建表與貨件作廢人索引，因此目前輸出退出碼 2；兩項 T019 離線測試通過並不代表正式 migration 已可從零重播。該腳本不連線任何 Supabase 專案。
- 套用上述三項新限制**之前**，已比對 10 個業務表、32 個約束、37 條 RLS 政策及 28 個索引，測試專案與主專案原本現況相符（排除備份表；Storage 政策的 bucket ID 依環境不同）。目前測試專案因這三項限制而有意與主環境不同。
- 已依使用者同意，在**測試專案**保留一個 `codex-cloud@example.invalid` 專用管理測試帳號。此電腦的 `credentials.local.json` 被 git 忽略，密碼由目前 Windows 使用者的 DPAPI 加密；它不能在另一台電腦或其他 Windows 使用者下直接解密。沒有服務角色金鑰，亦沒有把密碼或本機憑證提交到 GitHub。
- 固定指令 `npm run test:cloud` 只對寫死的測試專案 URL 登入，執行五種原子貨件情境、兩種 T028 重送防重情境、兩種原子快速新增商品情境及兩種 T031 商品重送防重情境；清除它建立的群組／貨件／商品／價格並全域登出。缺本機測試憑證會**失敗，不會 skipped**。它不包含 Google Drive、完整 UI 或所有資料關聯；不得把它算進離線 `npm run test` 的綠燈，也不得把主專案金鑰放進 GitHub Actions。
- 照片專用指令 `npm run test:cloud:photos` 只接受同一組測試專案安全憑證，網址與私有桶固定為 `zfcsuxihpakrsohvcwlr`／`factory-photos-test`。以隨機商品和三條隨機圖片路徑驗證實際上傳、首次關聯與相同路徑重送、換圖後清舊圖、過期前置路徑被拒絕且本次新圖清除；最後逐一刪除並確認商品／圖片與登入工作階段。缺憑證或專案 ID 不符會以 Failed 結束，不會 skipped。**目前尚未在安全憑證環境執行，三個案例不可列 Passed**；也沒有驗證一般員工或多請求交錯情境。

## 執行方式與目前結果

目前透過已連接的 Supabase 工具，逐一對**明確指定的測試專案 ID**執行 Txxx.sql；若工具回報 SQL error 就記為 Failed，不可跳過或改成 Passed。下列 14 個情境可重跑，其中 T019 是已更新結構的舊式讀寫補充驗證，並非 migration 重播：

| 情境 | 現況 | 範圍 |
|---|---|---|
| T008 | Passed | 修改廠商不改叫車地點 |
| T009 | Passed | 無效廠商／貨件外鍵被拒絕 |
| T010 | Passed | 相同「廠商代碼＋簡稱」及「叫車名稱＋地址」被拒絕；不同組合可並存，空代碼同簡稱也被拒絕 |
| T011 | Passed | 已存貨件快照不受後續價格列修改影響 |
| T012 | Passed（此 SQL 情境） | 單一資料庫交易失敗會回滾；新增貨件 API 的三種情境另由 `npm run test:cloud` 驗證，整體 T012 仍有未覆蓋流程 |
| T018 | Passed | 從 SQL 呼叫真實 `replace_vendor_price` 函式，留舊價、關閉日期、拒絕重複換價；尚未驗證 REST 登入／RLS |
| T019（更新後舊式讀寫） | Passed | `T019_legacy_writes.sql` 不使用新欄位建立及修改商品、70 元價格、貨件，確認新欄位保持 NULL、舊值可讀並清理。測試專案連跑兩次通過，測後三表的測試前綴均 0 筆；**不代表真實 migration 已可重跑** |
| T021 | Passed（SQL 層） | 貨件照片新增或修改成另一貨件的路徑均被拒絕；正確路徑可新增。物件存在檢查、資料列失敗清除、相同路徑重送與網路無回應重試另有離線測試，已登入測試專案 API 尚待執行 |
| T026 | Passed | 真實資料庫 RLS：管理員可新增、員工可讀但不能新增管理員資料、未核准者不可讀寫；使用無密碼的交易內假帳號，最後整筆回滾 |
| T027 | Passed | 真實管理員可原子建立商品與價格；錯誤價格外鍵不留商品；員工被拒絕。交易內假帳號與資料整筆回滾，重跑兩次通過 |
| T028 | Passed（SQL 層） | 相同 request ID／內容回傳同一貨件，只留一筆貨件與群組；同 key 改內容被拒絕；連跑兩次通過。另以兩個資料庫連線並發呼叫、其中一個持鎖 2 秒，得到一個 `replayed=false`、一個 `replayed=true`，最後仍為 1 筆貨件／1 筆群組；測後清理為 0。已登入 API 固定情境已加入但尚未執行 |
| T029 | Passed | 加入可空防重欄位後，以舊三參數建立 RPC 建立貨件，再以既有修改 RPC 更新；維持可讀、相同 ID／群組及空的防重欄位。連跑兩次通過，測後貨件／群組均為 0 |
| T030 | Passed | 永久刪除先在單一交易保存圖片路徑並刪除關聯資料；關聯刪除失敗整筆回滾，Storage 失敗狀態可重試並完成。連跑兩次通過，測後合成貨件／照片／清理工作均為 0；測試 Edge v9 已部署，登入實測尚未執行 |
| T031 | Passed | 快速新增商品相同 request UUID／內容只建立一筆商品與價格，廠商製程／價格備註完整保存，改內容回 409；舊 RPC 保持可用。更新後連跑兩次通過，既有兩連線持鎖並發通過，測後商品／價格／測試帳號均為 0；登入 API 案例尚未執行 |

另一次分階段 T019 驗證：先在舊結構放入合成價格 70，再套用價格歷史 migration，舊列仍為 70 且 `end_date` 為空。這是一次性的真實 migration 驗證，尚未做成可一鍵重建重跑的流程，**不得額外計入上表的 14 個可重跑情境**。

新增可重跑的**價格歷史表 DDL 子集演練**：`price-history-rehearsal.mjs` 校驗歷史 migration 的 SHA-256，只擷取函式宣告前的表 DDL，將 `public.vendor_prices` 映射到交易內暫存的舊式 `t019_vendor_prices`；先插入價格 70，再套用原欄位、限制及索引語句並驗證舊值與失敗案例，最後 `rollback`。只允許指定測試專案，任何歷史 SQL 變更會先停止要求審查。已在測試專案**連跑兩次，1 Passed／0 Failed／0 Skipped**（每輪），並確認暫存索引及公開表測試前綴均為 0。這是上表 14 個資料情境之外的 **1 個獨立演練**，不含歷史函式／GRANT、完整舊版 baseline 或正式候選 migration，不得稱 T019 整體完成。

重跑時先用 `node --input-type=module -e "import {buildPriceHistoryRehearsalSql} from './tests/cloud/price-history-rehearsal.mjs'; process.stdout.write(buildPriceHistoryRehearsalSql('zfcsuxihpakrsohvcwlr'))"` 產生 SQL；核對首段測試標記及結尾 `rollback`，再由已連接的 Supabase 工具**明確指定測試專案 ID**執行。此指令本身只產生文字，不連資料庫。

先前的 **5 Passed／2 Failed／0 Skipped** 揭露 T010、T021 衝突；在**測試專案**加入限制後，7 個資料情境全通過，再加入 T026／T027 權限與原子性、T028 防重、T029 舊呼叫相容、T030 可重試刪除及 T031 商品防重情境，當時可重跑 SQL 層為 **13 Passed／0 Failed／0 Skipped**。本輪另加 T019 更新後舊式讀寫情境，連跑兩次 **1 Passed／0 Failed／0 Skipped**，所以各情境最近已驗證合計 **14 Passed／0 Failed／0 Skipped**；這不是本輪重新批次執行全部 14 個情境。T009 的測試圖片路徑夾具同步改成符合新路徑格式，以便專注驗證外鍵拒絕；不是降低預期。T010、T021、T026、T027、T029、T030、T031、T019 更新後舊式讀寫各已重跑兩次。主環境尚未套用限制或新函式，不能宣稱主環境也通過。

2026-09-22 的已登入一次性整合檢查另計為 **8 Passed／1 Failed／0 Skipped**，詳見 `AUTHENTICATED_SMOKE_2026-09-22.md`。失敗的是 T012／T017：無效貨件 POST 回 400，卻留下先建立的收貨群組。測後已清除這筆群組；貨件照片的真實 Storage 上傳、關聯與永久刪除則通過。這不是自動測試的綠燈，不應與上述 SQL 層數字合併。最後確認相關業務表、暫時帳號與測試圖片均為 0 筆。

先前只修改 POST 驗證順序後，`npm run test:cloud` 對「缺商品名稱仍建立群組」案例通過，但這不保證第二步寫入失敗會回滾。因此再把**測試專案的新增貨件 POST** 改為單一資料庫函式。首次擴充雲端測試時，故意讓第二步失敗得到 HTTP 500，但函式的錯誤回應只有 `[object Object]`，無法確認失敗位置，故**整次指令記為 Failed**，未當成綠燈。補上正常建立的對照情境後，確認相同輸入只改成無效地點會在貨件插入時失敗，而群組與貨件都留下 0 筆；先前連續兩次為 **3 Passed／0 Failed／0 Skipped**。

接著先對舊 PATCH 加入紅燈案例：無效地點使貨件更新失敗，但留下 **1 筆新群組**，整次為 **3 Passed／1 Failed／0 Skipped**；測試清除該群組。修正後，換群組 PATCH 也使用單一資料庫函式，最近一次固定指令為 **5 Passed／0 Failed／0 Skipped**。成功時新群組正確關聯；失敗時新群組為 0 筆、原貨件 ID／群組／地點不變；暫存資料與工作階段清除，專用帳號保留。

快速新增商品原本從網頁分兩次寫入，補救刪除也未檢查結果；草稿分支的 `board/` 與 `calculator/` 現共用具防重 key 的單一 RPC。`calculator/` 在商品成功但照片失敗時會明確告知不要重複新增；照片關聯另由可重送的 `product-photos` 處理，跨 Storage／資料庫仍不是原子交易。上傳前保存分頁待辦，重開後以同一路徑補關聯；新待辦遇物件尚未出現時保留兩分鐘，避免上傳請求晚於頁面恢復檢查才完成。超過兩分鐘的上傳、關閉整個分頁或清除瀏覽器資料仍可能失去待辦；同一商品併發換圖時資料庫與 Storage 清理的競速也尚未消除。T032 十二種離線情境通過，測試 Function v3 已部署並回讀，但真實登入上傳未執行。先前已登入測試專案的正常商品＋價格關聯，以及故意讓價格外鍵失敗後商品為 0 筆的情境均通過。最近已實際執行的固定指令仍為 **7 Passed／0 Failed／0 Skipped**；更新後的指令預期共 11 項，其中兩項 T028 與兩項 T031 因本環境沒有安全登入憑證尚未執行，不能先算 Passed。與上述 SQL 層情境分開計數；完整瀏覽器操作仍未覆蓋。

主環境正式 migration 的前置檢查與未解決項見 `MAIN_MIGRATION_REVIEW.md`；這次沒有更動主環境。測試專案匿名登入維持關閉；T026／T027 的交易內假使用者 RLS 測試與已登入 Auth／Edge／Storage smoke 各自記錄。下一步是在原本保存憑證的 Windows 環境執行更新後的 `npm run test:cloud`，再依多步寫入盤點逐項處理；正式 migration 仍須另行審核。Google Drive 備份還原繼續延後。
