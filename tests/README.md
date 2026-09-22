# 執行測試

需求：Node.js 22.13+、可用的 Chromium／Edge／Chrome。先安裝鎖定的開發依賴（`pnpm install --frozen-lockfile`），再於專案根目錄執行固定指令：

```sh
npm run test
```

若瀏覽器不在常見位置，設定 `TEST_BROWSER_PATH` 為其執行檔。缺瀏覽器會明確失敗，不會 silently skip。這套指令每次都重建記憶體內測試資料；不需要 Supabase 帳號、正式資料或連線。成功條件是 passed 等於總數，failed 與 skipped 都等於零。

本機手動開啟資料頁時，可把 `config.local.example.js` 複製成被 git 忽略的 `config.local.js`，並填入**獨立雲端測試專案** `factory-board-test` 的 publishable key。本機網址只接受該測試專案或回環位址，不接受主 Supabase 或其他雲端專案；測試圖片使用該專案已建立的私人 `factory-photos-test` bucket。不要把 secret／service-role key 放進前端設定。測試專案目前已有業務資料表、Storage 權限政策與 `shipments` Edge Function（測試桶版本），但沒有供瀏覽器登入的測試身分；因此資料頁目前不能視為完整可操作的雲端 E2E。雲端資料庫情境與執行限制見 `tests/cloud/README.md`。

GitHub 每次推送、提出合併請求或手動啟動時，也會執行 `.github/workflows/offline-tests.yml`。該工作流程只有唯讀的倉庫權限，不傳入 Supabase／雲端憑證；綠燈表示離線回歸測試通過，**不**代表真實資料庫整合測試已完成。`npm run test` 仍明確拒絕遠端 Supabase 環境變數，避免把離線測試誤當雲端整合測試。
