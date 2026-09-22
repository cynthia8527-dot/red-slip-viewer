# 後端現況快照（唯讀參考）

本目錄取回的是主 Supabase 專案的**程式與 migration 文字**，不是營運資料、資料庫備份或可直接部署的測試環境。取得過程只讀取結構與函式原始碼；沒有對主專案寫入或執行測試。

- `main-migrations/`：2026-09-21 從 `supabase_migrations.schema_migrations.statements` 取回的 17 筆歷史 SQL，保留原版本號和名稱。這些檔案是歷史快照，**不要直接整批套用**：`add_automatic_text_backup_schedule` 會建立自動排程，`enable_pg_net_for_backup_seed`／`remove_unused_pg_net` 屬備份相關歷史，而早期 `allow_public_read_test_catalog` 的公開讀取政策在主專案現況已不存在。
- `edge-functions/shipments/index.ts`：主專案 `shipments` 函式版本 2 的原始碼快照（SHA-256 `b923d2dbcb5b896cff844a7bbfab3ffde31893108e0b166808c24db807382017`）。其中圖片桶名稱仍寫死為 `factory-photos`，**不可原樣部署到測試專案**；測試專案使用 `factory-photos-test`。

目前的 `dispatch_locations` 表與 `shipments_voided_by_idx` 索引未見於這 17 筆 migration；早期公開讀取目錄政策也已不在主專案現況。測試專案使用 `../cloud/` 的**測試專用**重建 SQL 補齊，並比對業務表、約束、政策與索引。後續若要讓正式環境與測試環境都能從零重建，需補一份經核對的現況 baseline／修正 migration；不要把歷史快照當成已驗證的正式部署腳本。
