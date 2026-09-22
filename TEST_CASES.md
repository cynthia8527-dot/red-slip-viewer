# 測試情境與隔離邊界

本文件把「不希望改壞的核心規則」與「尚未定案的功能」分開。`npm run test` 是**離線**完整指令，通過不等於雲端整合測試通過。`npm run test:cloud` 執行獨立測試專案的已登入 API 情境；其餘雲端 SQL 情境放在 `tests/cloud/`，透過 Supabase 連接工具逐一執行，不計入離線 passed。這個缺口不能用 skipped 或綠燈掩蓋。任何測試若 skipped、失敗或無測試，都不得宣稱整套通過。情境編號為 T001–T029；T020、T022 仍延後或待確認。

## 環境與資料邊界

- 主環境專案 ID：`icqdmzndjmxffnlciijs`。只在 GitHub Pages 的既定主網域使用；主環境資料庫、`factory-photos` bucket 與備份完全不作測試目標。
- 獨立雲端測試專案：`factory-board-test`，ID `zfcsuxihpakrsohvcwlr`；與主專案是兩個不同的 Supabase 專案。專用私人圖片桶 `factory-photos-test` 已建立，未複製主環境圖片。測試網頁只接受該專案或 `localhost`／`127.0.0.1`／`[::1]` 的 Supabase URL，且必須提供與主環境不同的 bucket。`config.local.js` 未提供時網頁直接失敗，不回退主環境。
- 目前自動測試使用 `tests/fixtures/` 的合成資料、記憶體內 SQLite，以及只綁定回環位址的暫時網頁伺服器；每個資料測試重新建庫並在結束時關閉，瀏覽器測試結束時關閉瀏覽器與伺服器。沒有遠端資料、正式圖片、正式備份或雲端依賴。
- `tests/fixtures/schema.sql`、`legacy.sql`、`migration.sql` 仍是**合成契約夾具**。另已把主專案記錄的 17 筆 migration SQL 與 `shipments` Edge Function 原始碼取回存於 `tests/reference/`，只作唯讀參考，不自動部署。獨立測試專案已重播與業務表有關的歷史 SQL，排除備份排程及過時的公開讀取政策；缺失的叫車表及索引以 `tests/cloud/` 的現況重建 SQL 補足。依已確認的規則，測試專案另套用 `enforce_confirmed_data_contracts.sql` 的三項限制；主環境尚未套用。沒有複製主環境資料。
- 離線完整測試的前置防呆仍拒絕非回環的 `TEST_SUPABASE_URL`、`SUPABASE_URL`、`DATABASE_URL`、`POSTGRES_URL`，也會拒絕任何資料頁直接寫入主專案 ID。瀏覽器 smoke 只允許本機請求，Supabase JS 載入由測試替身攔截；意外遠端請求會使測試失敗。雲端測試專案只供後續**獨立**整合測試使用，不會偷偷加入離線綠燈。
- 測試專案內有獨立 `test_guard.project_identity`，每個可重跑的雲端 SQL 情境在寫入前先核對專案 ID；誤指到主專案會因缺少此標記而失敗。雲端測試只用合成資料，成功時自行刪除，失敗時單一 `DO` 敘述回滾。專用測試帳號保留 1 筆；最近兩次 `test:cloud` 後工作階段、群組、貨件、照片及測試圖片均為 0 筆。登入憑證僅在此電腦加密保存，且被 git 忽略。

## A. 已確認核心規則

| 編號 | 測試目的 | 前置條件 | 操作 | 預期結果 | 核心規則 | 自動測試位置／目前覆蓋層 |
|---|---|---|---|---|---|---|
| T001 | 測試端點不可連主環境 | 測試設定範例 | 驗證回環、指定測試專案及其他遠端 URL | 僅回環與指定測試專案通過，主專案與其他雲端拒絕 | 是 | `tests/config.test.mjs`；設定層 |
| T002 | 測試圖片不可使用主 bucket | 本機設定範例 | 改為主 bucket／缺 key | 設定被拒絕 | 是 | `tests/config.test.mjs`；設定層 |
| T003 | 本機未設定不得退回主環境 | 本機網址、缺設定 | 載入設定 | 明確錯誤，沒有主環境 fallback | 是 | `tests/config.test.mjs`；設定層 |
| T004 | 已發布頁面保留原有主設定 | 既定 GitHub Pages 網域 | 解析設定 | URL／bucket 維持既有值 | 是 | `tests/config.test.mjs`；設定層 |
| T005 | 日期價格不被新價提前或舊價覆蓋 | 合成兩期價格 | 查換價前後日期 | 各取當日有效價 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T006 | 價格歷史留舊價且不混廠商 | 同商品兩廠商、兩期價格 | 查旭呈歷史 | 50、70 都在，乙廠 90 不混入 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T007 | 不同廠商價格獨立 | 同商品兩廠商 | 查目前價格 | 兩廠商各保有正確單價 | 是 | `tests/pricing.test.mjs`；實際前端共用價格函式 |
| T008 | 廠商與叫車資料互不污染 | 合成資料、獨立測試庫 | 修改廠商 | 叫車地點不變 | 是 | `tests/data.test.mjs`＋`tests/cloud/T008.sql`；雲端通過 |
| T009 | 無效廠商／貨件外鍵不得寫入 | 合成資料、獨立測試庫 | 寫入不存在的廠商／貨件關聯 | 外鍵拒絕 | 是 | `tests/data.test.mjs`＋`tests/cloud/T009.sql`；雲端外鍵通過，圖片路徑另見 T021 |
| T010 | 相同組合不得意外重複建立 | 合成資料、獨立測試庫 | 重複建立相同「廠商代碼＋簡稱」或「叫車名稱＋地址」；也試不同組合與空代碼 | 相同組合第二筆拒絕，不同組合可建立 | 是 | `tests/data.test.mjs`＋`tests/cloud/T010.sql`；獨立測試專案通過且可重跑，主環境尚未套用限制 |
| T011 | 貨件價格快照不隨改價變 | 合成資料、獨立測試庫 | 建貨件快照後改價格 | 快照保留原價 | 是 | `tests/data.test.mjs`＋`tests/cloud/T011.sql`；已登入測試專案 Edge Function 實測出貨快照 70、金額 140，後續價格改為 50 時快照不變；紀錄見 `tests/cloud/AUTHENTICATED_SMOKE_2026-09-22.md` |
| T012 | 錯誤操作不留下半套資料 | 合成資料、獨立測試庫 | 貨件 POST／換群組 PATCH 及快速新增商品＋價格，各故意讓第二步失敗；另測正常流程 | 失敗時不留下半套資料，正常操作仍可用 | 是 | 資料庫交易測試、**測試專案** API 七種情境與快速新增函式 T027 通過（`tests/data.test.mjs`、`tests/cloud/T012.sql`、`tests/cloud/authenticated-smoke.mjs`、`tests/cloud/T027.sql`）。三個指定流程已改為單次資料庫交易；**其他多步流程仍須逐一盤點，T012 整體未宣稱全面通過** |
| T013 | migration 後舊資料可讀 | 合成舊版資料 | 執行合成欄位新增 | 舊列保留且取得預設值 | 是 | `tests/data.test.mjs`；遷移模式示例，待真實 migration 驗證 |
| T014 | 四個資料頁不再寫死主 URL | 倉庫前端原始碼 | 檢查設定匯入 | 都經共用設定且無主 ID | 是 | `tests/smoke.test.mjs`＋`tests/run.mjs`；靜態防呆 |
| T015 | 基本入口未遺失 | 倉庫前端原始碼 | 檢查入口及共用函式 | 頁面及模組存在 | 是 | `tests/smoke.test.mjs`；靜態 smoke |
| T016 | 瀏覽器不發出主環境請求 | 本機伺服器、測試設定與假 Supabase client | 無登入開啟四個資料頁 | 頁面載入、無腳本錯誤、無外部資料請求 | 是 | `tests/browser.test.mjs`；本機瀏覽器 smoke，非完整 UI E2E |
| T023 | GitHub 自動測試不能取得雲端憑證 | GitHub workflow 檔 | 檢查工作流程權限與指令 | 僅有倉庫唯讀權限、執行全套離線測試、無 Supabase／資料庫密鑰 | 是 | `tests/smoke.test.mjs`＋`.github/workflows/offline-tests.yml`；CI 靜態防呆 |
| T024 | 雲端 SQL／登入測試必須先核對專用專案 | 雲端測試檔 | 靜態檢查 SQL guard、登入測試固定 URL 與憑證忽略規則 | SQL 都查 `test_guard.project_identity`；登入測試只指向專用專案；不含主專案 ID | 是 | `tests/cloud-config.test.mjs`；離線安全防呆 |
| T025 | 貨件函式測試部署不得使用主圖片桶 | 追蹤中的函式原始碼 | 僅對指定測試專案建構部署版本 | 只有圖片桶呼叫換成測試桶，主專案 ID 被拒絕 | 是 | `tests/edge-function.test.mjs`＋`tests/cloud/shipments-test-source.mjs`；離線防呆 |
| T026 | 管理員、員工與未核准者的資料權限分開 | 獨立測試庫、交易內合成 Auth 使用者 | 分別切換真實資料庫 `authenticated` 角色與使用者 ID，讀寫廠商／叫車資料 | 管理員可新增；員工可讀但不可新增管理員資料；未核准者不得讀寫；整筆回滾 | 是 | `tests/cloud/T026.sql`；獨立雲端測試庫通過且可重跑，非登入 API 測試 |
| T027 | 快速新增商品與初始價格一致且僅管理員可用 | 獨立測試庫、交易內合成管理員／員工 | 正常建立商品＋價格、注入無效廠商外鍵、員工嘗試建立 | 正常建立有且僅有一筆關聯價格；失敗不留商品；員工被拒絕；整筆回滾 | 是 | `tests/cloud/T027.sql`；測試專案重跑兩次通過；真實登入 API 另見 `tests/cloud/authenticated-smoke.mjs` |
| T028 | 貨件建立成功但回應逾時後重送不重複 | 相同請求 UUID 與內容；另以同 UUID 改內容 | 連續送出兩次，模擬第一次回應遺失 | 相同內容回傳同一貨件且只留一筆；同 key 改內容回 409 | 是 | Edge 與網頁離線測試通過；`tests/cloud/T028.sql` 在測試專案連跑兩次通過，Edge v5 已部署；已登入 API 情境已加入固定指令但本環境無安全憑證，尚未執行 |
| T029 | 防重欄位加入後舊貨件 RPC 仍相容 | 獨立測試庫已加入可空防重欄位，使用舊三參數建立與舊修改 RPC | 建立舊式貨件後讀取、修改備註再讀取 | 舊呼叫仍成功且 ID／群組不變，防重欄位保持空值 | 是 | `tests/cloud/T029.sql`；測試專案連跑兩次通過且清理為 0，主環境未套用 |

## B. 待確認或待取得後端原始碼

| 編號 | 測試目的 | 前置條件 | 操作 | 預期結果 | 核心規則 | 自動測試位置 |
|---|---|---|---|---|---|---|
| T017 | 真實 API 防重與交易性 | 獨立測試庫及安全的測試身分 | 重送建立請求並注入中途錯誤 | 不重複、無半套資料 | 是，尚未完全驗證 | 已登入 `shipments` API 的 POST 與換群組 PATCH 第二步失敗均在測試專案驗證回滾；重送防重的資料庫 SQL 已通過且測試 Edge 已部署，登入 API 仍待有安全憑證的環境執行；見 T028 與 `tests/cloud/README.md` |
| T018 | 真實價格替換與出貨快照 | 獨立雲端測試專案、`replace_vendor_price`／`shipments` 原始碼 | 換價、出貨、再換價 | 歷史不覆蓋且快照不改 | 是，部分通過 | `tests/cloud/T018.sql` 的 RPC 通過；另以真實登入身分呼叫測試專案 `shipments` 出貨，後續改價時快照保持 70，見 `tests/cloud/AUTHENTICATED_SMOKE_2026-09-22.md`；此流程尚未納入固定自動化雲端指令 |
| T019 | 真實 migration 舊資料相容 | 歷史 SQL 與合成舊版樣本 | 僅在獨立測試庫放舊價格後套用價格歷史 migration | 舊價格可讀且原值保留 | 是，首次階段驗證通過 | `tests/reference/main-migrations/`；已實際分階段驗證一次，尚無一鍵重建重跑 |
| T020 | Google Drive 備份可還原 | 獨立測試雲端位置與測試備份 | 備份、刪除測試副本、還原 | 內容及 ID／關聯一致 | 是，延後 | 尚無；本階段不碰雲端備份 |
| T021 | 真實圖片上傳、關聯、清除 | 獨立雲端測試專案的 Storage bucket | 寫入、修改錯位貨件照片路徑；上傳／清除 | 錯位被拒絕且不留下孤兒 | 是，部分通過 | `tests/cloud/T021.sql` 的路徑限制通過；已登入測試身分實際上傳圖片、建立關聯，作廢並永久刪除貨件後資料列與 Storage 物件皆為 0；主環境尚未套用路徑限制，見 `tests/cloud/AUTHENTICATED_SMOKE_2026-09-22.md` |
| T022 | 介面位置、文字與流程 | 產品、貨件、叫車等 UI 規格定案 | 操作視覺細節 | 待產品決策 | 否，待確認 | 不寫死；目前僅 T016 smoke |

## 已發現的規格／現況衝突與風險

1. `board/` 的舊快速新增先 insert `products` 再 insert `vendor_prices`，失敗時另做未確認結果的刪除補救，可能留半套資料。草稿分支現改為一次 RPC，在**測試專案**驗證價格寫入失敗會回滾商品；主環境還沒有該函式，草稿 PR **不可在未部署正式 migration 前合併發佈**。網路逾時後重送的防重問題仍未處理。
2. 主專案的 17 筆歷史 SQL 可取回，但 `dispatch_locations` 表及 `shipments_voided_by_idx` 索引不在記錄中；早期公開讀取政策在現況中已不存在。已在**測試專案**用現況重建檔補齊並核對；這些差異不可直接當成新的主環境 migration。
3. T010 原本在獨立雲端測試庫失敗。產品端已確認：「廠商代碼＋簡稱」相同或「叫車名稱＋地址」相同應擋下第二筆。測試專案已加資料庫唯一限制並通過；**主環境未套用**，且尚未驗證真實 API 的重送冪等性。
4. T021 原本在獨立雲端測試庫失敗。測試專案已加照片路徑必須以所屬貨件 ID 開頭的資料庫限制並通過；**主環境未套用**。已登入的測試專案 Storage 上傳與清除也已實測一次，但尚未有可重跑的一鍵雲端指令。
5. 主專案 `shipments` Edge Function 目前把圖片桶 `factory-photos` 寫死，且**未部署這次的 POST／PATCH 原子性修正**。測試專案部署版本從追蹤中的 `supabase/functions/shipments/index.ts` 建構，僅把該桶映射為 `factory-photos-test`。測試專案另外安裝了 `tests/cloud/create_shipment_atomic.sql`、`update_shipment_atomic.sql`；它們有專案標記防呆，**不是主環境 migration**。
6. **T012／T017 的三個指定流程已修、整體仍未結案：**測試專案的貨件 POST、換群組 PATCH、快速新增商品＋價格均由單一資料庫函式寫入；正常操作與第二步失敗回滾均已實測。修正前 PATCH 失敗留下 1 筆群組，修正後不再殘留。其他多步流程與重送請求防重尚未驗證。主環境未部署。
7. 草稿分支已加入貨件 POST 的 `Idempotency-Key` 設計與測試專案專用候選 SQL：同一 key 先取得交易級 advisory lock，再查既有結果；同內容回傳原貨件，不同內容拒絕。網頁把尚未確知結果的 key 保存在 `sessionStorage`。候選 SQL 已只在測試專案安裝，T028 SQL 連跑兩次通過且沒有殘留貨件／群組，測試 Edge Function v5 已部署；登入 API 重送因本環境沒有專用帳號密碼尚未執行。主環境未部署。

## 維護規則

純重構、效能優化、UI 排列調整：核心預期不改，測試應繼續通過。已確認業務規格正式變動：先更新本文件的相應情境及理由，再更新測試與實作；不可只為讓紅燈變綠而降低預期。schema 或 API 變動：新增版本化 migration 與舊資料相容測試。任何測試如果需要連遠端主 Supabase、主圖片 bucket、主備份或主雲端資料，應直接拒絕，而不是改成「暫時跳過」。
