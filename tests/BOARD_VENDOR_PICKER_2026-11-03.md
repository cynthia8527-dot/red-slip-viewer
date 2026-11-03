# 新增貨件廠商選擇彈窗（未發布候選）

基準 `f26c4a64cbf7a2b0ed5de8e4aaed4cadf507c0b6`，獨立分支 `candidate/board-vendor-picker-20261103`。只改 board 新增貨件第 1 步 UI、合成瀏覽器測試及說明；不沿用 PR 7 發布批准。

點目前廠商或「清單選擇」即可開原生 dialog，完整直式常用清單按現有 code 自然排序，展示名稱與發票抬頭；同名公司保持各自 UUID。搜尋含編號／名稱／抬頭，有明顯清空搜尋按鈕。每次打開都清空查詢，預設常用，不需先刪原名；明確切全部可找到隱藏／停用身份。舊無 vendor_id 價格來源保留為歷史文字，未建檔手動文字也能明確使用，不推定 UUID、不借用同名公司商品。

開窗聚焦取消，點搜尋才喚出鍵盤；原生背景 inert、Tab 循環、ESC 一次關閉（避免 search input 先吞 ESC 清字）。列表自身捲動，使用 visualViewport 高度限制視窗，搜尋字體 16px。關閉還原觸發點焦點及原頁捲動。取消不改廠商、商品、備註、重量、批次或已選照片；改選不同身份只清除不相容商品 UUID／價格預覽，其他草稿欄位保留。重複選取事件在關窗後忽略。選回同一 UUID 保留商品。

新增 fVendor 不再連結原生 datalist，點擊以直式彈窗選擇；保留既有鍵盤手動文字輸入 seam、唯一名稱／重名身份核對與商品提交邏輯。編輯 eVendor 與歷史回顯沒有更動，仍保留原 UUID，即使廠商改碼／改名／隱藏／停用。

測試沿用現有真實 Chromium 頁面操作＋合成 SDK/API 提交邊界。新增三個公開情境：300 筆自然排序和同名 UUID 商品／提交、375px 手機重選／清空／取消／ESC／430px 低視窗／長名／照片草稿、隱藏與歷史文字／手動名稱／改碼重讀。既有歷史編輯、快速新增、改碼、管理 modal 回歸全部保留。不是實機 iOS／Safari，也沒有正式 Auth／DB／Storage 測試或遠端 CI。

注意事項閱讀折疊原型已依最新要求移出，僅留未提交私人備份 `/workspace/board-notes-uncommitted-backup`，不在候選／交付 patch。calculator、process_notes 儲存與價格資料均未改。

輸入圖片 libfile_4da998ae679881918654a6e6aa74258c 已按 Library 正式 resolved-ref 流程 prepare_materialize；官方 helper 回 `library file transfer failed: download failed`，未取得可讀本地圖片，沒有重試或換路。未聲稱實看 pixels，實作依實際 board 程式及父端已看圖的描述。原圖與真實聯絡資料不在 repo 或預覽。

回復：本候選未發布，套用前先 git apply --check，反向完整 diff 可回到基準；或對候選 commit 做 git revert。只改本輪 UI／測試／說明，不操作任何資料庫或旗標。正式發布需另取得明確批准。
