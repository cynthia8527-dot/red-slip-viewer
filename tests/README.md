# 執行測試

需求：Node.js 22.13+、可用的 Chromium／Edge／Chrome。先安裝鎖定的開發依賴（`pnpm install --frozen-lockfile`），再於專案根目錄執行固定指令：

```sh
npm run test
```

若瀏覽器不在常見位置，設定 `TEST_BROWSER_PATH` 為其執行檔。缺瀏覽器會明確失敗，不會 silently skip。這套指令每次都重建記憶體內測試資料；不需要 Supabase 帳號、正式資料或連線。成功條件是 passed 等於總數，failed 與 skipped 都等於零。

本機手動開啟資料頁時，可把 `config.local.example.js` 複製成被 git 忽略的 `config.local.js`，並填入**獨立本機 Supabase** 的 publishable key。本機網址不接受任何遠端 Supabase 專案；測試 bucket 須與主環境不同。不要把 secret／service-role key 放進前端設定。要測真實資料庫、Storage 與 Functions，先把實際 schema 和函式原始碼版本化，再建可重建的本機 Supabase stack；詳見根目錄 `TEST_CASES.md` 的 T017–T021。

GitHub 每次推送、提出合併請求或手動啟動時，也會執行 `.github/workflows/offline-tests.yml`。該工作流程只有唯讀的倉庫權限，不傳入 Supabase／雲端憑證；綠燈表示離線回歸測試通過，**不**代表真實資料庫整合測試已完成。
