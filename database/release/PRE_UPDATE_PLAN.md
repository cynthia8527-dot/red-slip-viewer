# 更新前備份與退回方案（準備稿，沒有執行授權）

2026-10-02 高風險時序修正稿，接續已停止的候選 `724a8830ebf1a745d9a2c0c8a0fbf0cdb8e1768b`。
**舊候選的任何核准不可套用到新 head。** 本稿所屬 PR #3 最新提交才是新候選；發布前須
重新解析並核准 exact SHA（以父任務／GitHub 最終提交記錄為準），不得自行發布。
本輪只獲准隔離修正、合成驗證及符合條件後保存草稿，未獲正式 DB／RPC／部署執行授權。
跨年凌晨月份篩選按使用者要求暫緩；金額浮點尾數僅調查，計價／捨入規則未改。
這份文件不是部署腳本。不得用 `database/rebuild` 空庫 baseline 更新既有資料庫。
本輪只準備文件、核對候選；不匯出正式資料、不選目的地、不建立備份、不改權限、不部署。

## 已知起點與保留項目

正式站的結構及彙總唯讀檢查已完成；部署時必須重新核對身分和漂移。
新版防重欄位／RPC／私有清理表尚不存在，`shipments` 是 v2（JWT 開啟），
`product-photos` 尚不存在。新增限制的重複／路徑衝突未查到，不能視為永久保證。

正式 `private.capture_factory_text_backup(text,text)` 已產生 v3 快照，
涵蓋目前業務表，較 `tests/reference/main-migrations` 保存的 v1 來源新。
`public.backup_snapshots`、該 capture 函式、compact 函式、既有 cron 排程／權限
都必須原樣保留。候選增量 SQL 不引用或修改它們；不能重播歷史備份 migration。
發布前後須比對這些函式定義、擁有者／ACL、表結構／RLS、排程的摘要值。
不要呼叫 capture/compact 函式作為檢查（它們會寫入／刪除）。

## 要保住的完整內容

| 類別 | 必須保存／驗證 | 敏感性與限制 |
|---|---|---|
| 業務資料 | 商品、歷史價格、廠商／據點、貨件／群組／照片關聯、叫車地點、profiles、allowed_emails、既有 backup_snapshots；全部 UUID、金額、時間、作廢資訊；私有業務表若發布時存在 | 包含真實帳務、聯絡及個人資料，不進 Git、CI artifact 或聊天 |
| 結構與規則 | schema、欄位／預設值、序列、限制、索引、函式、trigger、RLS、grants、extensions、migration history；備份 v3 函式與 cron | 實際版本為準；不可拿歷史重建候選代替現況 |
| 照片 | 私有桶設定／政策、完整物件清單及所有原始 bytes；路徑、大小、類型、SHA-256 與資料列關聯 | 包含未引用物件，先保留；metadata 不等於檔案；不產生公開連結 |
| Auth／平台相依 | 恢復原有使用者 ID 所需的 Auth 資料；自訂 Auth trigger、登入提供者／redirect／SMTP 等設定清單；平台／DB 版本 | Auth 可能含密碼雜湊、身份／MFA／session 敏感資料，須另列入匯出核准；不得自行重設密碼或權限 |
| 程式與設定 | 實際在用的網頁發布物與 exact commit、現行 Edge 原來源／import map／JWT 設定；新舊版本配對 | Git main 不等於已發布網站；先核實現行發布物。秘密不放版本庫 |
| 秘密／加密相依 | 確認原有金鑰、連線及必要加密根金鑰是否能由原管理者安全復原 | 只記「由誰保管／能否取回」，不將值放一般備份 manifest；Vault／欄位加密是否使用尚未確認 |

不可把 CLI 預設輸出當成上述全部已涵蓋。需要明確檢查 Auth/Storage 自訂內容、
migration history、角色及平台設定的涵蓋範圍。現有合成演練保留 schema/Auth，
不證明全平台／Auth 災難復原；這項缺口仍在。

## 工具、目的地與目前缺口

已本地核對官方 CLI **2.118.0** 的 `db dump --help` 及 `storage cp --help`：
支援結構／資料／角色檔案輸出，以及 Storage 目錄下載。原生 pg_dump/pg_restore
**17.6** 加 Storage API 已在拋棄式平台完成業務資料＋照片演練。
這些是工具能力，不代表已取得正式匯出存取權；本輪沒有測試正式匯出連線。

目前唯一已核實的正式備份位置是「同一資料庫的文字快照」，沒有照片 bytes，
不能抵抗整個專案遺失。Supabase 平台備份/PITR 的啟用、可用恢復點、方案及費用
均未確認。不得自行啟用付費功能。現有 cloud workspace 可暫存但非可靠長期目的地；
GitHub artifacts、公開 repository、既有隔離測試 DB／桶皆不是正式備份目的地。
Google Drive 繼續暫緩。

**沒有任何外部長期目的地已被確認可用。** 下一個最小問題是請使用者指出
「由本人保管、可存放加密資料庫＋照片備份的既有位置」。不要先要求貼密碼。
若是私人雲端，須再核實確切帳號／資料夾、現有 connector、容量、讀寫與刪除政策；
若是本人保管的檔案儲存位置，須另確認由誰接收、加密／金鑰保管及下載後可讀性。
這不是授權在使用者桌面執行程式。目的地未核實前不開始正式 export。

## 最小執行關卡（以下全部待另行批准）

1. **位置與範圍**：核准確切目的地、接收者、上述真實資料／Auth 類別、保存期限、
   加密方式及金鑰保管者；確認既有存取途徑，缺少權限時停止，不自行新增持續 access。
2. **一致時間點**：安排短暫停止業務寫入／上傳的窗口，包含舊分頁、API 和相關自動寫入；
   方式和影響須審核，不能只靠畫面公告宣稱凍結。記錄截點，核對 DB 與 Storage 前後清單。
   單一 DB snapshot 不涵蓋並行 Storage 變動；無法建立一致截點就不宣稱完整可還原。
3. **取得及驗證副本**：使用已審查的明確來源／範圍匯出；在核准暫存及目的地加密保存。
   比對列數、關聯、歷史金額、物件清單與 hash；從目的地重新讀取驗證。
   不漏掉未引用照片、不自動清垃圾；錯誤／缺檔必須停止。正式副本不進測試 CI。
4. **復原證据與退回點**：先完成合成全結構／Auth 相依的恢復設計與適用演練；
   實際私人副本的隔離還原需要另一個明確批准的目的地與存取範圍，不能默認使用公共 CI。
   明確標示哪些層已驗證、哪些未驗證，再決定是否接受剩餘風險。
5. **審查並批准發布包**：重新 fetch 確認 exact head、完整測試結果、現行發布物、
   遠端 schema 漂移與 v3 備份摘要；核准時間窗口與操作者。正式測試不可寫入合成資料。
6. **有序更新**：只套增量候選（下一節），成功核對後更新兩個指定 Edge Functions，
   保留 JWT 與正式桶設定，最後發布網頁。每步失敗停在該步，不跳過驗證。
7. **恢復使用**：唯讀核對原資料／政策／備份 v3／照片一致性，確認正式 smoke 範圍另有核准；
   發布與備份時間記錄完畢才恢復寫入。保留舊版本及副本至核准的觀察期結束。

## 可審查的升級包

- DB 增量第 1 步（保留原交易／原內容）：`database/upgrade/supabase/migrations/20260930085010_upgrade_reconstructed_legacy_business.sql`。
  一個交易、5 秒 lock timeout；新增四個 nullable request 欄位、限制／索引、
  交易／防重／清理 RPC 與私有清理工作表。不是正式套用批准。
- DB 增量第 2 步：`database/upgrade/supabase/migrations/20261002154901_guard_retired_requests_and_product_photos.sql`。
  獨立交易、5 秒 lock timeout，依賴第 1 步；不得將兩步說成單一原子交易。
  新增私有 `retired_shipment_requests` 與 `retired_product_photo_paths`、trigger 及
  service_role-only `claim_product_photo_cleanup(uuid,text)`。第 2 步失敗會回滾它本身；
  停止發布，保留已成功的第 1 步，不先刪欄位／資料回退。
  新 RPC 為 SECURITY INVOKER；兩個私有 trigger 函式為受限 SECURITY DEFINER，僅執行
  已獲 DML 權限操作的資料完整性保護，所有應用角色都沒有直接 EXECUTE 權限。
  不新增帳號、金鑰、runner 規格或 workflow 權限。
- Edge 僅 `supabase/functions/shipments/index.ts`、`supabase/functions/product-photos/index.ts`。
  不部署測試來源轉換器，不複製測試桶或測試環境設定。發布前須再審查依賴解析／import map。
- 新 `product-photos` 必須等第 2 步完成才可上線；缺 RPC 時不會執行 Storage 刪除。
  DB guard 安裝本身不能修好還在運作的舊照片 Edge；必須協調完整更新與舊分頁／請求窗口。
  新照片只能使用全新路徑；已退休路徑不復用，網頁也須包含 `data/product-photo-pending.js`
  的終止重試處理與 calculator 提示。
- 網頁發布物必須由同一審核 SHA 建立，包含共用 `data/` 模組及 board/calculator/vendors/dispatch
  相依檔案；沿用正式設定，不把 CI 的 loopback 設定發布。
- 新增物件和現有 v3 備份功能互不覆寫；但尚未演練「完整實際生產 schema 的副本」升級，
  目前是來源可追溯的合成舊 schema，不能把這個差異藏起來。

## 退回方式

- DB 交易失敗：Postgres 應回滾該次交易；唯讀確認無部分 DDL、原資料／v3 備份未變。
  不在正式 DB 故意製造失敗來測試。
- DB 成功但後端／網頁失敗：暫停繼續發布／寫入，按依賴將網頁及 Edge 恢復至已保存的
  **實際舊版本**；先在隔離環境驗證「舊程式＋新增後 schema」相容，再核准執行。
  不先刪新欄位、索引、清理工作或兩張 retirement 表；那可能丟掉資料並重新打開重送／換圖漏洞。
  舊照片 Edge 不呼叫 cleanup claim，直接退回它會重現併發刪圖風險；不能把「舊網頁＋新 schema」
  相容演練當成安全照片 rollback。需保留新照片後端，或在另行核准的回退方案中停止照片寫入。
- 懷疑資料損壞：保留失敗後狀態，停止寫入，定位受影響範圍。還原 DB 必須配同截點照片。
  若截點後已有新交易，先規劃如何保留／核對它們，不能直接覆蓋整庫。
  破壞性還原、刪新物件、重設 Auth 或擴大權限都需要獨立批准。
- 網頁／函式退回不會自動倒回資料；資料倒回也不會自動恢復照片或部署版本。

## 已有證據與未完成驗證

基準 SHA 的 98 項 offline/browser 及 GitHub fresh/upgrade/volume/recovery 全通過。
合成還原驗證金額、關聯、原始照片 bytes、缺圖／壞圖拒絕，且測後零殘留；
但不涵蓋線上寫入一致性、真實備份目的地、全平台 Auth/加密依賴及實際舊發布物退回。
本次僅文件準備，沒有重新執行已通過的昂貴合成演練冒充新證據。

官方依據（能力說明，不代表此專案已啟用）：
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- 已驗證合成平台 CI：https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36700582280


## 2026-10-02 本輪證據與新增保留條件

詳見 `tests/longevity/FIX_REPORT_2026-10-02.md` 與重現命令。原 100 項回歸維持通過，
加上兩項高風險、五項安全／恢復與一項終止重試回歸；另有三 seed 年度狀態序列、
原生 PostgreSQL 17.11 五種雙連線鎖交錯，以及半年資料升級後再操作半年。
確切計數／耗時以該報告與最終 SHA 的 CI 結果為準，不沿用 724a883 的綠燈。
全平台 Supabase／Storage 整合本輪尚未在本工作區重跑；既有平台腳本只加上候選及
合成 retention teardown，未修改 runner、權限或部署設定。

兩張 retirement 表是必要業務狀態，備份、還原與未來遷移都必須保留；不得因沒有
貨件／照片關聯而清掉它們，也不可套任意 TTL。既有 v3 文字備份函式原樣保留，
**不宣稱它已涵蓋新增 private 表**；正式更新前須確認核准的備份／復原包涵蓋這兩表。
原生業務 dump 演練會納入 public/private，完整生產副本復原仍屬另一關卡。

沒有追補安裝 guard 之前已刪除貨件的 request ID，因舊資料已不保留而無法憑空還原。
Photo retirements 保護的是已走新版 claim 流程的刪除；管理員直接操作 Storage、舊 Edge
或既存失聯圖片不會自動修復。仍無背景清理 worker；Storage 失敗維持待辦及原重試流程。
