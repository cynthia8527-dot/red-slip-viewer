> Historical evidence: the later user-selected whole-unit money fix is documented in
> [MONEY_REPORT_2026-10-02.md](MONEY_REPORT_2026-10-02.md). Earlier money failures below
> describe their recorded candidate, not the current implementation.

# 兩项高風險修正驗證

**本輪批准範圍完成：刪除後舊請求復活、並發換圖誤刪。相關測試通過；不是全產品零風險。**
起點與推送前遠端核對：`724a8830ebf1a745d9a2c0c8a0fbf0cdb8e1768b`，原草稿 PR #3。
新候選 exact SHA 以本報告所屬 Git 提交及父任務最終回報為準；舊 SHA 的部署批准不可沿用。
沒有正式資料、远端測試資料、MCP 核准、部署、合併、runner／workflow 權限或憑證變更。

## 修正內容與證據

- **貨件請求永久防重**：已刪除貨件的 request UUID 保存在私有 retirement 表，與刪除同一交易。
  直接授權 DELETE 也會記錄；key／fingerprint 不得被 UPDATE 改掉。
  相同 key 的建立與刪除使用同一交易 advisory lock；已消耗 key 的 INSERT 拒絕並回滾
  先建立的群組。原請求再送得到 409，清理工作重送仍正常。刪除回滾不會消耗 key。
- **照片刪除先取得持久許可**：service-only RPC 鎖商品行，确认路徑未被引用，保存不可
  再用的路徑，提交後才刪 Storage。產品 AFTER trigger 同時保護 Edge 與直接 catalog DML；
  late UPDATE／INSERT 不能重新引用已退休路徑。新連結與刪除 claim 兩種先後次序都驗證。
  RPC 失敗絕不直接刪檔；Storage 失敗可重送清理。前端清掉已退休路徑的終止重試項目，
  提示重新選照片；既有新上傳使用新 UUID 路徑。

兩個最短舊案例先各重現 FAIL，再在同樣合成條件轉為 PASS；沒有改成「預期錯誤即通過」。
L002 現在要求 409 且零貨件；L004 要求晚到的舊圖重連 409、第一個請求 201、目前新圖存在。

## 驗證結果

| 驗證 | 結果 | 實際耗時 |
|---|---|---:|
| 固定 `npm test` | **108 PASS / 0 FAIL / 0 skipped**；原 100＋兩個高風險＋五個安全／恢復＋一個終止重試 | 22.413 秒 |
| 三個年度 seed | 同 5,654 高階操作、591 貨件，非金額精度不變量 PASS；額外 252 次已刪 key 重送全部拒絕 | 56.431 秒 |
| 每月照片序列 | 36 次換圖，含 18 次受控競速、15 次 Storage 清理失敗／恢復；69 次照片 Edge 請求 | 包含在上列 |
| 原生 PostgreSQL 17.11 | **5 PASS**，每例實查 `pg_stat_activity` 證明第二連線真的在等鎖 | 0.839 秒（含临時 cluster 初始化／停機） |
| 六個月資料 → 遷移失敗／成功 → 六個月操作 | **1 PASS**，144 舊＋144 新貨件，36 舊照片關聯、完整舊欄位不改寫；另報 144 新金額精度不符 | 7.909 秒 |
| 兩項暫緩問題的嚴格診斷 | **0 PASS / 2 FAIL / 0 skipped**，金額精度及跨年午夜月份 | 5.188 秒 |

年度 seed：34087、539492905、12648430；各 2027-11 到 2028-10，另含閏日／跨年探針。
各 seed 為 1886／1832／1936 操作、2148／2086／2212 貨件 Edge 請求，另各 23 照片請求。
總共 6446 貨件請求＋69 照片請求；12 次 DB 保存／關閉／重新載入、48 次完整資料稽核。
保持原 288 次 SQL／貨件 Storage／分頁故障注入，照片新增 15 次清理故障另計。
价格凍結比較全部保存值與時間的原值，不以浮點容忍值掩蓋改寫。
三 seed 的精確金額不符仍為 66／81／81 筆，與原調查一致，年度 CLI 因此仍 exit 1。
沒有將這個「部分性質通過」改寫成一年全過，也沒有將模擬速度稱為真實一年性能。

原生五例：先退休路徑後重連、先重連後要求清理、先刪貨件後原 key 重送、刪除回滾後
等待中的重送、刪除商品 UUID 後同 UUID INSERT 仍不得重用退休路徑。
每例是不同資料庫連線，並非 PGlite 的串行佇列。Storage 仍為替身；沒有宣稱真實 Storage
兩請求整合已跑過。原生二進位為 Debian 小套件（合計約 19 MB），SHA256 比對官方下載頁；
不下載／啟動 Supabase 大容器。临時服務只開私有 Unix socket，測後停止並刪資料目錄。

## 金額尾差的實際影響（沒有改計價規則）

`money-impact.mjs` 執行原始 Edge、候選 SQL，以及原始 board `amountSnapshotText`：

| 單價 × kg | 精確期望 | Edge／DB 原值 | 畫面格式函式 | DB 差值 |
|---|---|---|---|---|
| 0.10 × 3 | 0.30 | 0.30000000000000004 | NT$ 0.3 | 0.00000000000000004 |
| 70 × 12.345 | 864.15 | 864.1500000000001 | NT$ 864.15 | 0.0000000000001 |

- JavaScript `===` 精確期望、SQL numeric `=` 精確期望：兩例都是 false。
- 兩例 SQL round 到兩位分別 0.30／864.15；這是診斷，沒有把 round 寫進產品。
- 以原 DB 值乘 10,000 的加總探針為 `3000.00000000000040000`、
  `8641500.0000000010000`。尾差仍小於一分，但這不是對所有金額範圍的保證。
- 原始碼檢查目前出貨快照用於逐筆顯示，未找到使用此欄位的應收總計或金額匯出功能；
  不虛構 Excel／帳本有誤差。原始 API／DB 值確實已有尾數，若未來精確對帳／匯出直接使用
  原值，就需先定義十進位精度及捨入規則。這兩例沒有實證可見的分／元錯帳。

跨年午夜月份按使用者要求保持未修；`board/index.html` 沒有修改。

## 安全、相容與發布依賴

新 migration 由 CLI 建立，三份來源／重建／升級副本的 hash 一致。沿用舊升級 bundle，
另加一個有 5 秒 lock timeout 的交易；後段失敗只回滾新增 guard，不聲稱整段升級一個交易。
測試晚期 DDL 衝突確認新增表／trigger 全回滾、原資料不改寫。

新 public RPC 為 invoker，只有 service_role 能執行；兩張 private 表有 RLS，anon／
authenticated 沒有讀寫權；photo 表僅给 service_role SELECT／INSERT。兩個 private
trigger-only definer 函式空 search_path、完整 schema qualification、應用角色沒有直接
EXECUTE。它們只對原本已授權的 DML 加完整性限制，不授予新的商品或貨件讀寫權。
已測 active admin 的正常商品編輯仍可行，直接指向退休圖片被拒絕。

新增 retirement 狀態須長期保留且納入備份。不能清理作廢貨件後順便清掉防重紀錄，
也不能自設 TTL。既有 v3 備份函式未變，不宣稱已自動涵蓋新 private 表。
無法回填安裝前已永久刪除且遺失 key 的舊請求；不修復既存失聯圖片。
沒有新增背景 worker；分頁關閉、上傳與 Storage 的其他不確定性仍遵循既有界線。

已更新 `database/release/PRE_UPDATE_PLAN.md`：兩個 DB 步驟 → 照片／出貨後端 → 網頁；
新照片 Edge 缺 RPC 時安全失敗。退回舊照片 Edge 會重新引入競速，因此不能沿舊核准
自動發布或回退。全平台 Supabase／Auth／真實 Storage、新 head CI 結果須另行區分。

## 可重現與原始證據

命令見 `README.md`；本輪證據在被忽略的 `tests/tmp/longevity/fix/`：
`offline.tap`、`native.log`、`annual.log`、`annual-results.json`、`upgrade.tap`、`deferred.tap`。
其內容全部合成，不上傳 runtime 資料。固定套件包含新回歸，原生鎖測試是可選本機命令；
沒有只可先推 CI 才能驗證的新腳本。既有 full-platform harness 的新增候選／清理 SQL 已在
PGlite／原生 PostgreSQL 驗證，整套 Docker 平台沒有在此工作區重跑。
