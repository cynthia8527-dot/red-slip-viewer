# 從空業務 schema 重建的審核候選

此目錄是 **2026-09-30 新編的重建紀錄**，不是找回的原始 migration，也不是正式部署核准。來源基準為 PR #3 commit `470d8fe937da95eb5349dfbcb9ec2979c77477cd`。歷史 17 份快照保持原文；其缺漏仍由原 inventory 如實回報。

## 順序與来源

| 新候選（依檔名順序） | 內容與來源 |
|---|---|
| `20260930075150_reconstructed_business_baseline.sql` | 13 份歷史業務 SQL 原文，接續兩份 observed DDL；另明列空業務 schema 防呆及 pgcrypto schema 依賴 |
| `20260930075151_request_columns.sql` | 原 `supabase/migrations/20260930040920_add_idempotency_request_columns.sql` 原文，保留 request pair／fingerprint 與唯一索引限制 |
| `20260930075152_business_contracts_and_rpcs.sql` | 三項已確認資料限制與六份 RPC 安裝來源；含 7 個 RPC，連同 baseline 的 `replace_vendor_price` 共 8 個業務 RPC |

三個新檔名都由 Supabase CLI **2.118.0** 的 `migration new` 產生，沒有倒填日期或改寫歷史時間戳記。獨立 `database/rebuild` workdir 避免把今日 baseline 排在根目錄較早的增量候選之後，造成錯誤的預設重播順序。不得把兩個 migration 目錄混合後直接 `db push`。

```sh
supabase migration new reconstructed_business_baseline --workdir database/rebuild
supabase migration new request_columns --workdir database/rebuild
supabase migration new business_contracts_and_rpcs --workdir database/rebuild
```

本工作機使用 npm 官方 `supabase@2.118.0` 包，將 `SUPABASE_HOME` 及 npm cache 指向可寫的 workspace；沒有讀取其他秘密或重設帳密。

`manifest.json` 保存每份候選與來源的 SHA-256，執行前逐份檢查。來源擷取規則：

- `verbatim`：完整來源原文；不重寫歷史 DDL。
- `observed-ddl`：去除說明前言，保留第一個 CREATE 起的原 DDL。
- `after-test-guard`：保留 `$guard$;` 後的 DDL／函式。原 guard 是遠端測試專案識別或重複資料預查；此新鏈只允許空業務 schema，資料限制本身仍由 PostgreSQL 執行。
- `rpc-only`：保留第一個 `create or replace function` 起的函式及權限，移除來源最尾端交易結束；request 欄位與限制統一由第二份 migration 提供，不重複安裝較舊的寬鬆限制。交易由候選外層完整包覆。

## 缺口核對及真實依賴

1. `public.dispatch_locations`：來源為 `tests/cloud/observed_dispatch_locations.sql`。2026-09-30 唯讀核對 factory-board-test 的 11 欄、預設值、非空／非空白限制、RLS 及 3 條政策相符。依賴 `authenticated`、`private.is_active_factory_user()`、`private.is_factory_admin()`，所以位於角色函式建立之後。一般登入角色只能 SELECT/INSERT/UPDATE、不能 DELETE；寫入仍由 admin RLS 限制。`(name,address)` 唯一限制是後來確認的測試合約，放第三份 migration，不偽稱歷史表自帶此限制。
2. `shipments_voided_by_idx`：來源為 `tests/cloud/observed_shipments_voided_by_index.sql`；唯讀確認為 `public.shipments USING btree (voided_by)`，無 unique 或 predicate。依賴歷史 void 欄位／Auth FK，放在該欄位建立之後。
3. **空庫測試另外揭露的 pgcrypto 位置依賴**：初版候選三份 SQL 都能執行，但 T031 呼叫失敗，SQLSTATE `3F000: schema "extensions" does not exist`。RPC 明確呼叫 `extensions.digest(bytea,text)`；歷史 `create extension if not exists pgcrypto` 未指定位置，在空庫落入 public。唯讀確認測試站 pgcrypto 1.3 位於 extensions，authenticated/service_role 有 USAGE。候選因此先明確建立此 schema／extension／必要 USAGE；若既存 pgcrypto 位於其他 schema，直接失敗要求審核，不自動搬移。

沒有查詢或更動正式 schema；上述 live 參考僅來自已授權測試專案的系統 catalog，不含業務列、帳密或資料匯出。測試站現況不是原始歷史的證明。

## 執行及驗證界線

```sh
pnpm install --frozen-lockfile
node tests/rebuild/replay.mjs
npm run test:rebuild
TEST_BROWSER_PATH=/usr/bin/chromium npm run test
```

目前 runner 使用鎖定的 PGlite 0.5.8 PostgreSQL，**每次從全新記憶體 DB 開始**，不接受 URL 或 connection string，不可能連到遠端資料庫。先建立 `tests/rebuild/platform-contract.sql` 的明列平台介面，再逐一執行三份候選原文，不在 runner 偷改 migration SQL。驗證 10 張業務表、RLS、角色權限、索引、8 個 RPC、拒絕重套及保留原資料；然後在這個拋棄式庫內建立既有 SQL 測試所需 guard／bucket 名稱，執行 14 個既有 Txxx 情境，核對資料與假帳號零殘留，最後關閉並丟棄 DB。

**這是全部候選業務 SQL 的空庫重播，不是完整 Supabase 服務重建。** 平台介面僅模擬 `auth.users`／`auth.uid()`、Storage 表／foldername、角色及預設服務權限；不是 Auth／Storage 官方完整 schema，不驗證 GoTrue、PostgREST、Storage HTTP、JWT、Docker PostgreSQL 多連線、平台升級或真實登入。RLS／RPC SQL 在 PostgreSQL 引擎實際執行，並非字串比對或 SQLite 模擬。

本輪 Docker daemon 可用但無預載 image，`docker pull postgres:17` 在 registry 握手即回 `Forbidden`，尚未建立 Docker DB 或開始完整平台重播；沒有繞過網路政策。下一個安全步驟是在允許官方 image 的環境／預載官方 Supabase stack 上建立拋棄式專案，以相同候選顺序重播並對比 managed catalog，再做登入 API 整合；不能重置現有遠端測試站來替代這一步。

## 有意排除／仍未完成

- 歷史 `allow_public_read_test_catalog` 與三份備份／pg_net migration 不重播：前者會恢復過時匿名讀取；後者包含排程／備份資料與網路 extension，超出純業務重建授權。全部四份原文仍保存且在 manifest 列明。本候選不宣稱恢復備份服務。
- 根目錄舊 inventory 仍會退出 **2**，正確指出原歷史檔案的兩個洞；新鏈用獨立實跑驗證覆蓋，不能把 inventory 變綠當作重建成功。
- 候選保留第二份增量既有的 fingerprint 64 位十六進位限制；它比測試站早期商品 pair CHECK 更嚴格，不把這個差異說成正式站現況。
- 對既有正式資料的升級／migration history 整合、完整備份與還原、正式權限／所有權差異、多連線競速、全 Supabase stack 與完整 UI 登入流程仍須獨立驗證及部署審核。
- 本輪沒有 push、merge、遠端 schema 修改、權限修改或部署。

## Full platform CI

`.github/workflows/rebuild-platform.yml` runs `tests/rebuild/full-platform.mjs` on an ephemeral Ubuntu 24.04 runner using official Supabase CLI 2.118.0 and its pinned Docker platform images. A random unlinked project starts with no business migrations; the three exact manifested candidates replay through native PostgreSQL in order. It checks schema/RLS/grants, all 14 existing SQL regressions, actual Auth login, PostgREST anonymous denial and idempotent RPC, private Storage bytes/upload/delete, and zero fixture residue. CLI status credentials stay in process memory; no repository secrets or remote reset commands are used. Containers and volumes are stopped without backup in finally. Edge Function/browser cloud flows are not part of this new platform job. Historical inventory remains separately exit 2.
