# 已登入雲端 smoke：2026-09-22

這是對**獨立** Supabase 測試專案 `zfcsuxihpakrsohvcwlr` 的一次性人工整合驗證，**不屬於** `npm run test` 或可重跑的自動化雲端測試。主專案 `icqdmzndjmxffnlciijs`、主圖片桶及備份都沒有作為請求目標。使用不寄信的暫時帳號與 `tests/fixtures/sample.svg` 合成圖片；密碼、API token 未寫進倉庫。

| 檢查 | 實際結果 | 判定 |
|---|---|---|
| 暫時帳號登入與權限 | Auth 使用者確認成功，`profiles` 為 active admin | Passed |
| 已登入貨件列表 | `shipments` Edge Function GET 回空列表 | Passed |
| 建立測試貨件 | POST 建立 1 筆，廠商與商品 ID 指向測試夾具 | Passed |
| 出貨快照與後續改價 | 出貨單價快照 70/kg、2 kg 金額 140；現價後改 50，舊價歷史保留 2 筆，貨件快照仍為 70／140 | Passed |
| 真實 Storage 與照片關聯 | 圖片上傳至 `factory-photos-test`，`shipment_photos` 指向同一貨件及路徑 | Passed |
| 未作廢前禁止永久刪除 | DELETE 回 HTTP 409，貨件仍存在 | Passed |
| 作廢後永久刪除 | void 記錄操作人；DELETE 成功，貨件、照片資料列與 Storage 物件均為 0 | Passed |
| 撤銷與清理 | Auth 全域登出回 HTTP 204；刪除暫時帳號、允許清單與夾具後，相關 10 個資料區域均為 0 筆 | Passed |
| 錯誤操作不得留下半套資料（T012／T017） | POST 缺 `item_name`、帶 `intake_group_label`，回 HTTP 400 卻先建立 1 筆無貨件關聯的 `intake_groups`；測後已單獨刪掉 | **Failed** |

本輪一次性整合檢查：**8 Passed／1 Failed／0 Skipped**。離線測試與資料庫交易測試另計，不能用它們的綠燈抵銷此處失敗。

失敗原因可從 `tests/reference/edge-functions/shipments/index.ts` 直接對照：POST 先執行 `getOrCreateGroup(body)`，其後才檢查 `vendor_name`／`item_name`。這與 TEST_CASES.md 的 T012 核心規則衝突。本輪沒有修改函式、主專案或測試預期；後續應先確定「無效貨件不可建立群組」的規格，再在最小範圍內修復並加入可重跑的已登入 API 測試。

測試結束後，`auth.users`、`profiles`、`allowed_emails`、`vendors`、`products`、`vendor_prices`、`intake_groups`、`shipments`、`shipment_photos`、測試桶 `storage.objects` 均已確認為 0 筆。測試專案原有的 schema、函式與私有測試桶保留，供後續測試使用。
