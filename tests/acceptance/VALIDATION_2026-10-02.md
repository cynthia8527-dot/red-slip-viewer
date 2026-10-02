# 雲端工作環境驗收 — 2026-10-02

驗收起點：`f261670ffad93b0ac38497758b62af89be86c04b`，草稿 PR #3：
https://github.com/cynthia8527-dot/red-slip-viewer/pull/3 。
本次使用獨立 detached worktree，原工作目錄沒有未提交修改；保存前重新確認遠端 head。
倉庫及其父目錄未找到 AGENTS.md／專案 .agents/skills。

## 本次實際結果

- 原始 head：`npm test`，98 passed / 0 failed / 0 skipped。
- 新增 `tests/ui-acceptance.test.mjs` 並納入固定指令後：`npm test`，
  **99 passed / 0 failed / 0 skipped**，正式 Supabase connections=0。
- Node 24.19.0、pnpm 11.19.0、鎖定 Playwright 1.62.1；雲端現成 Chromium
  151.0.7922.173（Debian）。官方 Playwright Chromium 下載回傳 403 Domain forbidden；
  現成 Chromium 成功執行，未要求使用者開本機瀏覽器。
- 新情境使用真實 calculator／board 頁面、固定合成日期及攔截 API：
  取消新增商品不寫入、返回廠商列表、新增商品連點只送一次、取消調價不寫入、
  未來價格／目前價格／歷史顯示、日期跨生效日後顯示新價、進貨使用當日價格、
  取消進貨不寫入、進貨連點只建一筆、狀態更新 503 後重新載入再重試、
  編輯取消不寫入、處理中→完成待出貨→已出貨、出貨金額／月份／搜尋結果。
- 原套件的照片失敗與恢復、防重重送、權限邊界、分頁及資料規則仍通過。
  新畫面情境**不是**真實資料庫／Auth／Storage 整合證據；出貨金額為合成回應，
  金額計算正確性須看既有 SQL／後端測試，不能用此畫面測試取代。
- 開發新測試時曾誤等「新增貨件後表單關閉」而 timeout；現有產品行為是清空表單，
  已改用完成回應／畫面結果等待。這是測試假設修正，没有產品程式修改。

## 真實整合阻擋（不列通過／跳過）

嘗試 `REBUILD_CLI=... node tests/rebuild/full-platform.mjs --upgrade`。
CLI 2.118.0 的設定目錄權限已排除，但官方容器拉取先遇 public.ecr.aws Forbidden，
GHCR PostgreSQL 映像 `17.6.1.171` 解壓出現 `no space left on device`，
Docker Hub 備援又遇匿名拉取流量限制。只清除本輪下載、未使用的輔助服務映像後，
再次拉取該 PostgreSQL 映像仍空間不足；停止重試。無業務平台啟動、無真實 UI
整合新證據，拋棄式容器／volume 均已清除。

真實 UI 測試草稿只留於雲端 scratch，不加入 PR 或 CI，因為尚未驗證。
本輪沒有執行新的遠端測試專案登入套件，沒有下載私人備份、重跑家用備份測試、
修改每日備份、正式寫入、遠端部署、權限或憑證。

## 既有 CI 證據（本次唯讀重核，不是本次重跑）

同一 `f261670` 的 Offline regression tests #100 success：
https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36702629865 。
Full Supabase rebuild #16 的 fresh / upgrade / volume / recovery 四個 job 全 success：
https://github.com/cynthia8527-dot/red-slip-viewer/actions/runs/36702629892 。
3000 商品／10000 貨件的真實平台資料量證據沿用該 volume job；本次沒有重跑。
新提交的 CI 結果須另核對，不把舊 head 的綠燈套到新提交。

## 正式更新前關卡

維持草稿，不合併、不部署。沿用 `database/release/PRE_UPDATE_PLAN.md` 的部署依賴，
但其中備份目的地等狀態為當時紀錄，不能直接當成最新待辦。
委派交接已報告另一次家用隔離驗證：8 表 85 列逐欄、3 張 JPEG hash、登入與未授權
阻擋通過；本輪沒有重新讀取該副本，不把它宣稱為正式帳號／整站復原。

發布前仍須：
1. 在容量足夠的雲端環境完成真實 UI 串流程與必要失敗情境，再核對候選 exact SHA。
2. 重新唯讀確認正式 schema／RPC／照片端點漂移及既有備份函式、cron、ACL 摘要；
   先前缺新版 RPC／照片端點的盤點不是今天的即時現況。
3. 保存並確認實際在用的舊網頁發布物、Edge 原始碼與設定；Git main 不等於發布物。
4. 明列且接受未驗證邊界：Excel 批次匯入仍非交易、Storage／DB 並發換圖競速、
   完整實際正式 schema 的升級、實際舊發布物＋新 schema 的 rollback，
   以及全平台 Auth／加密依賴復原。CI 綠燈不表示零風險。
5. 先完成可審查的發布／回退包，再請使用者同意正式更新；順序固定
   **資料庫增量 → 後端 shipments／product-photos → 前端**。
   任一步失敗停止，不先刪新欄位或清理工作來回退。
