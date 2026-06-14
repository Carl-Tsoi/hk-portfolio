# 港股持倉管理系統 — 開發任務清單

本文件將每項開發任務的**輸入依賴、輸出交付物、技術約束、驗證標準**逐條定義，作為編碼階段的唯一執行依據。所有約束均來自討論結論，如與其他文檔衝突以此為準。

---

## 任務依賴圖

```
T1 腳手架
 └─ T2 數據庫層 (db.ts)
      ├─ T2.1 DDL 建表與索引
      ├─ T2.2 數據庫連接與環境降級
      ├─ T2.3 現金賬戶初始化
      ├─ T2.4 stock_universe 初始化導入
      └─ T2.5 stock_universe 同步更新
 └─ T2b 股票數據 (stock_universe.json)
      ├─ T2c init-db.mjs 腳本（依賴 T2b）
      └─ T2d download-hkex.mjs 腳本（獨立，僅需網路連接港交所）
 └─ T10 後台管理頁 (pages/admin/admin.vue)（依賴 T2, T3）
 └─ T3 portfolioService.ts (依賴 T2)
      └─ T4 usePortfolio.ts (依賴 T3)
           ├─ T5 pages/index/index.vue
           ├─ T6 pages/history/history.vue
           └─ T9 tx-popup.vue
      ├─ T7 pages/trade/trade.vue (依賴 T3, T4)
      └─ T8 pages/dividend/dividend.vue (依賴 T3, T4)
```

---

## T1 項目腳手架

### 文件
`package.json` `tsconfig.json` `vite.config.ts` `manifest.json` `pages.json`
`src/main.ts` `src/App.vue` `src/uni.scss` `src/shime-uni.d.ts`
`src/config/log.config.ts` `src/utils/logger.ts`

### 輸入
- 無

### 輸出
- 可運行的 uni-app (Vue3 + TS) 空殼
- TabBar 雙分頁配置：index（持倉）+ history（流水）
- 全局 SCSS 變量（顏色、字體、工具類）已定義於 `src/uni.scss`
- `App.vue` 中 `onLaunch` 調用 `db.initDatabase()`

### 依賴 (`package.json`)

| 依賴 | 版本 | 用途 |
|------|------|------|
| `vue` | `^3.4` | 前端框架 |
| `@dcloudio/uni-app` | `^3.0` | uni-app 框架 |
| `big.js` | `^7.0` | 高精度金融計算 |
| `sql.js` | `^1.10` | SQLite WASM（H5 + vitest） |
| `xlsx` | `^0.18` | Excel 解析（僅後台管理頁懶加載） |

| 開發依賴 | 版本 | 用途 |
|------|------|------|
| `typescript` | `^5.4` | 類型檢查 |
| `vite` | `^5.2` | H5 開發服務器 |
| `@dcloudio/uni-app-vite` | `^3.0` | uni-app Vite 插件 |
| `vitest` | `^1.6` | 測試框架 |
| `sass` | `^1.77` | SCSS 編譯 |
| `@types/big.js` | — | big.js 類型定義 |

**注意**：依賴安裝需要 DCloud 內部 registry，配置於 `.npmrc`。

### 約束
- 僅支援 5+ App Native 平台
- `manifest.json` 必須包含 `app-plus.modules.Sqlite: {}`
- pages.json 配置 `enablePullDownRefresh: true`（index 頁）
- 字體家族：`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- 等寬代碼：`"Courier New", Courier, monospace`

#### vite.config.ts — H5 開發服務器中間件

Vite 開發服務器需配置三個自定義中間件（僅 H5 模式，不影響 App 打包）：

| 路徑 | 方法 | 用途 | 實現要點 |
|------|------|------|----------|
| `/api/save-db` | POST | 接收 sql.js 二進制快照寫入磁盤 | 從 `req` body 讀取 `ArrayBuffer` → 寫入 `public/hk_portfolio_db.db` 和 `hk_portfolio_db.db`；每次寫操作觸發 |
| `/api/log` | POST | 接收瀏覽器日誌 | 從 `req` body 讀取 `{line}` → 追加寫入 `logs/server-YYYY-MM-DD.log` |
| `/api/log/clear` | POST | 清空當天日誌 | 每次 App 啟動時調用，truncate 當天的日誌文件 |
| `/api/yahoo/*` | ALL | 代理 Yahoo Finance API | 匹配 `/api/yahoo/(.*)` → 代理到 `https://query1.finance.yahoo.com/$1`，解決瀏覽器 CORS 限制 |
| `/api/hkex/*` | ALL | 代理港交所文件下載 | 匹配 `/api/hkex/(.*)` → 代理到 `https://www.hkex.com.hk/$1`，解決瀏覽器 CORS 限制 |

**日誌等級控制**：`scripts/log-config.mjs` 導出 `LOG_LEVELS` 數組（可選值：`trace`, `debug`, `info`, `warn`, `error`, `fatal`），中間件僅寫入匹配等級的日誌。

**Vite 中間件完整實現**：

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [uni()],
  server: {
    port: 5173,
    configureServer(server) {
      const LOG_DIR = path.resolve(__dirname, 'logs');

      // 1. /api/save-db — 接收 sql.js 快照寫回磁盤
      server.middlewares.use('/api/save-db', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync('public/hk_portfolio_db.db', buffer);
          fs.writeFileSync('hk_portfolio_db.db', buffer);
          res.writeHead(200);
          res.end('ok');
        });
      });

      // 2. /api/log — 接收日誌行寫入文件
      server.middlewares.use('/api/log', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const { line } = JSON.parse(Buffer.concat(chunks).toString());
          const date = new Date().toISOString().slice(0, 10);
          const logFile = path.join(LOG_DIR, `server-${date}.log`);
          if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
          fs.appendFileSync(logFile, line + '\n');
          res.writeHead(200);
          res.end('ok');
        });
      });

      // 3. /api/log/clear — 清空當天日誌
      server.middlewares.use('/api/log/clear', (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
          const { date } = JSON.parse(Buffer.concat(chunks).toString());
          const logFile = path.join(LOG_DIR, `server-${date}.log`);
          if (fs.existsSync(logFile)) fs.truncateSync(logFile, 0);
          res.writeHead(200);
          res.end('ok');
        });
      });

      // 4. /api/yahoo/* — 代理到 Yahoo Finance
      server.middlewares.use('/api/yahoo', async (req, res) => {
        const targetUrl = 'https://query1.finance.yahoo.com' + req.url!.replace('/api/yahoo', '');
        const response = await fetch(targetUrl);
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(await response.text());
      });

      // 5. /api/hkex/* — 代理到港交所
      server.middlewares.use('/api/hkex', async (req, res) => {
        const targetUrl = 'https://www.hkex.com.hk' + req.url!.replace('/api/hkex', '');
        const response = await fetch(targetUrl);
        const buffer = await response.arrayBuffer();
        res.writeHead(response.status, { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' });
        res.end(Buffer.from(buffer));
      });
    },
  },
});
```

### 注意
- TabBar 圖標為佔位圖，已放入 `static/`，正式上線前需替換

### 驗證
1. `npm install` 無報錯
2. 項目可啟動（H5 模式亦可）
3. 控制台輸出 `[App] Database initialized successfully`
4. `POST /api/save-db` → `public/hk_portfolio_db.db` 文件更新
5. `POST /api/log` → `logs/server-YYYY-MM-DD.log` 寫入日誌
6. `GET /api/yahoo/v8/finance/chart/0700.HK?...` → 返回 Yahoo 數據（代理成功）

---

## T2 數據庫層 (`src/utils/db.ts`)

T2 包含 5 個子任務，全部在 `db.ts` 中實現。依賴 T1 的項目腳手架。

---

### T2.1 DDL 建表與索引

#### 產出
數據庫初始化時按順序執行的 DDL 語句。

#### 5 張表

**`stocks` — 股票行情緩存表**
| 欄位 | 類型 | 約束 | 說明 |
|------|------|------|------|
| `stock_code` | TEXT | PK | 5 位等寬代碼，如 `00700` |
| `stock_name` | TEXT | NOT NULL | 官方名稱 |
| `current_price` | TEXT | DEFAULT '0.00' | 最新市價 |
| `yesterday_close` | TEXT | DEFAULT '0.00' | 昨日收盤價 |
| `updated_at` | TEXT | — | 行情更新時間戳 |

**`transactions` — 交易流水賬本表**
| 欄位 | 類型 | 約束 | 說明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | 流水 ID |
| `stock_code` | TEXT | NOT NULL, FK→stocks | 股票代碼 |
| `type` | TEXT | NOT NULL, CHECK IN ('BUY','SELL','DIVIDEND') | 交易類型 |
| `trade_date` | TEXT | NOT NULL | 交易日期 YYYY-MM-DD |
| `price` | TEXT | DEFAULT '0' | 成交單價 / 分紅總額 |
| `quantity` | TEXT | DEFAULT '0' | 數量，支持小數（碎股） |
| `fee` | TEXT | DEFAULT '0' | 手續費/扣稅 |
| `cash_impact` | TEXT | NOT NULL DEFAULT '0' | 現金變動額 |
| `remark` | TEXT | — | 備註 |
| `created_at` | TEXT | NOT NULL | 寫入時間戳 |

- 外鍵級聯策略：`ON DELETE RESTRICT`（禁止刪除有流水的股票）

**`cash_account` — 賬戶可用現金表**
| 欄位 | 類型 | 約束 | 說明 |
|------|------|------|------|
| `id` | INTEGER | PK AUTOINCREMENT | — |
| `available_cash` | TEXT | DEFAULT '0.00' | 允許負數 |
| `updated_at` | TEXT | — | 變動時間戳 |

- 全局僅 `id=1` 一條記錄

**`stock_universe` — 全市場股票列表**
| 欄位 | 類型 | 約束 | 說明 |
|------|------|------|------|
| `stock_code` | TEXT | PK | 5 位等寬代碼 |
| `stock_name` | TEXT | NOT NULL | 官方名稱 |

- 用途：模糊搜索的本地主數據源

#### 3 個索引
| 索引名 | 表 | 欄位 | 目標 |
|--------|-----|------|------|
| `idx_tx_stock_code` | transactions | `stock_code` | 個股流水彈窗極速過濾 |
| `idx_tx_date_created` | transactions | `(trade_date ASC, created_at ASC)` | 持倉重算正序遍歷 + 流水頁倒序展示 |
| `idx_universe_code` | stock_universe | `stock_code` | 模糊搜索 LIKE 匹配加速 |

#### 約束
- 所有金額欄位使用 TEXT 類型（與 big.js 精度閉環）
- DDL 使用 `CREATE TABLE IF NOT EXISTS`（冪等，重複執行安全）
- 索引使用 `CREATE INDEX IF NOT EXISTS`
- 建表順序：stocks → transactions → cash_account → stock_universe → schema_version（先建被外鍵引用的表）

**`schema_version` — 數據庫版本追蹤表**
| 欄位 | 類型 | 約束 | 說明 |
|------|------|------|------|
| `version` | INTEGER | PK | schema 版本號，從 1 開始遞增 |
| `applied_at` | TEXT | NOT NULL | 遷移執行時間 |

- 用途：追蹤數據庫 schema 版本，支援 App 升級時的增量遷移
- 初始版本 v1：當前 DDL 的完整集合即為 v1
- 遷移策略詳見 architecture.md §10

#### 驗證
- `initDatabase()` 執行後，5 張表存在
- 再次執行不報錯（冪等）
- 3 個索引存在

---

### T2.2 數據庫連接與環境降級

#### 產出
| 函數 | 用途 |
|------|------|
| `executeSql(sql, params)` | 寫入操作 (INSERT/UPDATE/DELETE)，返回 `{ rowsAffected }` |
| `selectSql(sql, params)` | 查詢操作 (SELECT)，返回 `{ rows: any[] }` |
| `runInTransaction(fn)` | 事務包裹，fn 內拋錯自動 ROLLBACK |
| `getIsAppPlatform()` | 返回布爾值 |

#### 環境判斷邏輯
```
if (typeof plus !== 'undefined' && plus.sqlite !== undefined)
  → App Native：使用 plus.sqlite.openDatabase / executeSql / selectSql
else if (typeof window !== 'undefined')
  → H5 瀏覽器：使用 sql.js (SQLite 編譯為 WASM)，支持真實 SQL
else
  → Node.js (vitest)：使用 sql.js 純內存模式，無持久化
```

#### App Native 路徑
- **數據庫文件名**：`hk_portfolio_db.db`（存於 App 沙盒 `_doc/` 目錄下）
- **數據庫連接名**：`hk_portfolio_db`
- **完整路徑**：`_doc/hk_portfolio_db.db`
- 單例連接維護（`dbInstance` 全局變量，避免重複 openDatabase）
- 原生回調全部 Promise 化

#### 數據庫文件命名規範
| 項目 | 值 |
|------|-----|
| 文件名 | `hk_portfolio_db.db` |
| openDatabase name | `hk_portfolio_db` |
| openDatabase path | `_doc/hk_portfolio_db.db` |
| 所在目錄 | App 沙盒 `_doc/`（iOS/Android 標準文檔目錄） |

#### H5 / Node.js 路徑（sql.js — SQLite 編譯為 WASM）
- 使用 `sql.js` 庫（npm: `sql.js`），將 SQLite 引擎編譯為 WebAssembly
- **H5 瀏覽器**：
  - 首次加載：`fetch(/hk_portfolio_db.db)` → sql.js 加載種子數據庫文件
  - 寫操作：sql.js 執行 SQL → 雙寫 IndexedDB（瀏覽器緩存）+ `POST /api/save-db`（Vite 中間件寫回磁盤）
  - 再次加載：優先從 IndexedDB 恢復，若無則 fetch 種子文件
  - 支援完整 SQLite 功能：LIKE、ORDER BY、事務（BEGIN/COMMIT/ROLLBACK）、COUNT(*)、索引
- **Node.js (vitest)**：
  - sql.js 純內存模式（不寫 IndexedDB，不發 POST）
  - 每個測試文件啟動時新建空數據庫 → `initDatabase()` → 測試 → 結束丟棄
  - 行為與 App Native 的 plus.sqlite 高度一致（同為 SQLite 引擎）
- 優點：H5 開發環境與真機使用**同一 SQL 語法**，消除環境差異導致的 Bug
- **與 App Native 的差異**：
  - 性能：sql.js WASM 比原生 SQLite 慢 2-5 倍（H5 開發可接受）
  - 持久化路徑：IndexedDB vs 沙盒文件系統（不影響業務邏輯）
  - 事務實現：見下方「⚠️ 已知風險：plus.sqlite 事務 API 兼容性」

#### ⚠️ 已知風險：plus.sqlite 事務 API 兼容性

DCloud 的 `plus.sqlite` 底層事務行為未經真機驗證，存在兩種可能：

| 情況 | 行為 | 影響 |
|------|------|------|
| 支持裸 SQL 事務 | `executeSql('BEGIN')` 後續操作在同一事務中 | Plan B 可直接使用 |
| auto-commit 模式 | 每個 `executeSql` 是獨立事務 | Plan B 失效，必須改用 Plan A |

**Plan A（優先嘗試）— 使用 plus.sqlite 原生事務 API**：
```js
// plus.sqlite 可能提供 transaction() 方法
function runInTransaction(fn) {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const exec = (sql, params) => new Promise((res, rej) =>
        tx.executeSql(sql, params || [], (tx, rs) => res(rs), (tx, err) => rej(err))
      );
      fn(exec).then(resolve).catch(reject);
    }, reject, resolve);
  });
}
```

**Plan B（降級方案）— 裸 SQL BEGIN/COMMIT/ROLLBACK**：
```js
async function runInTransaction(fn) {
  await executeSql('BEGIN TRANSACTION');
  try {
    await fn(executeSql);
    await executeSql('COMMIT');
  } catch (e) {
    await executeSql('ROLLBACK');
    throw e;
  }
}
```

**驗證方案（Phase 3 真機測試）**：
1. 在真機上執行：`BEGIN → INSERT → ROLLBACK`
2. 查詢確認數據已回滾（未殘留）
3. 若回滾成功 → Plan B 可用（sql.js、Node.js、plus.sqlite 三端一致）
4. 若回滾失敗/無效 → 改用 Plan A 重構

**sql.js 和 vitest 不影響**：sql.js 原生支持裸 SQL 事務，Plan B 在開發和測試環境中直接可用。

#### 約束
- **SQL 注入防禦**：100% 參數化查詢（`executeSql('INSERT INTO t VALUES (?)', [val])`），嚴禁字符串拼接
- 所有原生回調用 `new Promise` 包裹
- `runInTransaction`：sql.js 和 vitest 用 `BEGIN/COMMIT/ROLLBACK`；App Native 需真機驗證後選擇 Plan A（原生 API）或 Plan B（裸 SQL），詳見「⚠️ 已知風險」
- 依賴：`npm install sql.js`（H5 和 vitest 環境需要）
- Vite 服務器需配置中間件（參見 architecture.md §5.4）：`POST /api/save-db`、`POST /api/log`、`/api/yahoo/*` 代理

#### 驗證
1. H5 環境調用 `selectSql('SELECT 1')` → 不報錯
2. H5 環境 `INSERT` 後刷新瀏覽器 → 數據從 IndexedDB 恢復（持久化驗證）
3. H5 環境執行 `runInTransaction` → 拋錯後數據回滾
4. App 環境打開真機數據庫 → 成功
5. vitest 環境 sql.js 純內存 → 各測試文件獨立，不互相汙染
6. 參數化查詢綁定變量正常工作
7. 事務拋錯 → 數據回滾，不殘留髒數據（三種環境均驗證）

---

### T2.3 現金賬戶初始化

#### 產出
`initDatabase()` 中在 DDL 執行完後自動調用的初始化邏輯。

#### 流程
```
SELECT COUNT(*) FROM cash_account
  → count == 0?
    → YES: INSERT INTO cash_account (id, available_cash, updated_at) VALUES (1, '0.00', ?)
    → NO:  跳過
```

#### 約束
- 保證 `id=1` 記錄存在
- `available_cash` 初始值 `'0.00'`
- 冪等（重複執行不插入第二條）

#### 驗證
1. 首次啟動 → `SELECT * FROM cash_account` 返回 `[{id:1, available_cash:'0.00'}]`
2. 再次啟動 → 仍只有一條記錄

---

### T2.4 stock_universe 初始化導入

#### 產出
`initDatabase()` 中在 DDL 執行完後自動調用的導入邏輯。

#### 數據源
`/src/data/stock_universe.json` — 打包的全市場港股列表（~2500+ 條）

#### JSON 結構
```json
[
  { "stock_code": "00700", "stock_name": "騰訊控股" },
  { "stock_code": "09988", "stock_name": "阿里巴巴-SW" }
]
```
- `stock_code` 已格式化為 5 位等寬字串
- `stock_name` 為 Yahoo Finance 官方名稱

#### 導入流程
```
SELECT COUNT(*) FROM stock_universe
  → count == 0?
    → YES: 從 JSON 批量導入，每 500 條一個事務
           INSERT OR IGNORE INTO stock_universe (stock_code, stock_name) VALUES (?, ?)
    → NO:  console.log('stock_universe already has N records, skipping import')
```

#### 約束
- 僅在表為空時導入（`COUNT(*) == 0`），避免重複
- 批量策略：每 500 條一個事務（平衡性能與內存）
- 使用 `INSERT OR IGNORE` 避免重複鍵報錯中斷

#### 驗證
1. 首次啟動 → `SELECT COUNT(*) FROM stock_universe` ≈ 2500+
2. 再次啟動 → 跳過導入，記錄數不變
3. `SELECT * FROM stock_universe WHERE stock_code = '00700'` 返回「騰訊控股」

---

### T2.5 stock_universe 同步更新

#### 產出
| 函數 | 用途 |
|------|------|
| `syncStockUniverse(stocks[])` | TRUNCATE + INSERT 覆蓋全市場列表 |

#### 觸發時機
用戶在首頁點擊「同步市場數據」按鈕 → `fetchAndSyncStockUniverse()`（T3 實現）→ 調用此函數寫入

#### 流程
```
BEGIN TRANSACTION
  DELETE FROM stock_universe
  (批量 INSERT 新數據，每 500 條一個批次)
COMMIT
```

#### 約束
- 必須在事務中執行（TRUNCATE + INSERT 原子性）
- 參數 stocks 為 `{ stock_code: string, stock_name: string }[]`
- 若輸入為空數組，不執行（防止誤清空）

#### 驗證
1. 傳入新列表 → stock_universe 更新為新數據
2. 傳入空數組 → 不執行，現有數據保留
3. 事務中途失敗 → 數據回滾，保留舊數據

---

## T2b 股票主數據 (`src/data/stock_universe.json`)

### 輸入
- 港股全市場代碼與名稱，來自以下來源（按優先級）：

**數據獲取策略（三層降級）**：

| 層級 | 方案 | 覆蓋範圍 | 適用場景 |
|------|------|----------|----------|
| **L1** | 運行 `scripts/gen-universe.mjs` 掃碼生成 | ~2500+ 隻 | 正式發布前、定期更新 |
| **L2** | 最小種子文件（手寫 ~100 隻最活躍港股） | ~100 隻 | 開發階段、首次啟動無網路 |
| **L3** | 運行時手動輸入（無 stock_universe 匹配時） | 0 隻 | 緊急降級，模糊搜索不可用但交易錄入不受阻 |

**L1 — gen-universe.mjs 腳本**：
- 掃描港股代碼範圍（00001 ~ 09999，含主板和創業板前綴 08）
- 對每個候選代碼調用 Yahoo v8 API 驗證是否存在
- 並發控制：每 200ms 一個請求（避免限流），預期耗時 15-30 分鐘
- 輸出 `src/data/stock_universe.json`（UTF-8，按代碼升序）
- 腳本支持續傳（記錄已掃描範圍，中斷可續）

**L2 — 種子文件**：
- 手寫 ~100 隻最活躍港股（恆生指數成分股 + 主要 ETF + 熱門個股）
- 涵蓋主要行業：科技（00700、09988、03690）、金融（00005、01299、00388）、地產（00016、00017）、能源（00883）、消費（09633、02020）等
- 種子文件為開發階段最小可用數據，確保模糊搜索基本可用

**L3 — 運行時降級**：
- 若 `stock_universe` 中無匹配結果 → 提示「無匹配股票，可手動輸入代碼提交」
- 提交時若該股票在 `stocks` 表不存在 → 自動 INSERT（名稱暫用代碼本身）
- 後續行情刷新時由 Yahoo v8 API 補全名稱（`meta.longName`）

### 輸出
- `/src/data/stock_universe.json`
- JSON 數組，每條 `{ "stock_code": "00700", "stock_name": "騰訊控股" }`
- L1 完整版 ~2500+ 條，L2 種子版 ~100 條

### 約束
- `stock_code` 必須是 5 位等寬數字字串（如 `00700` 而非 `700`）
- `stock_name` 使用 Yahoo Finance 官方名稱
- JSON 文件編碼 UTF-8
- 按 `stock_code` 升序排列，方便人工查閱
- **種子文件必須提交到 Git**（確保 clone 後即可開發）
- **完整版 JSON 不提交 Git**（文件過大，由 gen-universe.mjs 本地生成）

### 驗證
1. JSON 格式合法，`JSON.parse()` 不報錯
2. 所有 `stock_code` 為 5 位數字字串
3. 無重複 `stock_code`
4. L1 完整版：記錄數 > 2000
5. L2 種子版：記錄數 ≥ 80 && ≤ 150

---

## T2c 數據庫種子腳本 (`scripts/init-db.mjs`)

### 輸入
- T2b 完成（`src/data/stock_universe.json` 存在）

### 輸出
- `scripts/init-db.mjs` — Node.js 腳本（無需 uni-app 環境）
- 執行後生成 `public/hk_portfolio_db.db`（SQLite 種子文件）和 `hk_portfolio_db.db`

### 功能
1. 使用 `sql.js`（或 `better-sqlite3`）在 Node.js 環境中創建 SQLite 數據庫
2. 執行 T2.1 定義的 DDL（5 張表 + 3 個索引）
3. 初始化 cash_account（`INSERT id=1, available_cash='0.00'`）
4. 從 `src/data/stock_universe.json` 讀取股票列表，批量導入 stock_universe（每 500 條一個事務）
5. 將數據庫文件寫入 `public/hk_portfolio_db.db`（Vite 靜態服務）和 `hk_portfolio_db.db`（項目根目錄備份）

### 約束
- 冪等：重複執行覆蓋舊文件，不報錯
- 獨立於 uni-app：純 Node.js 腳本，`node scripts/init-db.mjs` 即可執行
- 必須在 `npm run dev:h5` 之前至少運行一次

### 驗證
1. `node scripts/init-db.mjs` → `public/hk_portfolio_db.db` 生成
2. sql.js 打開該文件 → 5 張表均存在
3. `SELECT COUNT(*) FROM stock_universe` → ≥ 80（種子版）或 > 2000（完整版）
4. 重複執行 → 文件被覆蓋，不報錯

---

## T2d 港股列表下載腳本 (`scripts/download-hkex.mjs`)

### 輸入
- 網路連接 `www.hkex.com.hk`

### 輸出
- `scripts/download-hkex.mjs` — Node.js 腳本（桌面端用）
- 執行後生成/更新 `src/data/stock_universe.json`

### 功能
1. 下載港交所官方證券名單：`GET https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx`
2. 使用 SheetJS (`xlsx` npm 包) 解析 `.xlsx` 文件
3. 過濾規則：
   - **保留**：分類為「股本」「交易所買賣產品」「房地產投資信託基金」
   - **排除**：衍生權證、牛熊證、債券、股本權證
   - **排除**：人民幣櫃台（代碼尾號為 `8`，如 `89988`）
4. 代碼格式化：`padStart(5, '0')` → 5 位等寬字串
5. 按代碼升序排列
6. 輸出 `src/data/stock_universe.json`（UTF-8，~3,100 條）

### 列映射（HKEX xlsx → stock_universe）

| xlsx 列 | 字段 | 示例 |
|---------|------|------|
| A (股份代號) | stock_code | `00001` → `00001` |
| B (股份名稱) | stock_name | `長和` |
| C (分類) | 過濾條件 | `股本` ✅ / `衍生權證` ❌ |
| D (次分類) | 參考 | `股本證券(主板)` |

### 約束
- 依賴 `xlsx` npm 包（`npm install xlsx --save-dev`）
- 獨立於 uni-app：純 Node.js 腳本，`node scripts/download-hkex.mjs` 即可執行
- 輸出文件**提交到 Git**（~3,100 條，約 150KB，方便 clone 後立即開發）
- 可被 `scripts/init-db.mjs` 調用（自動化流程）
- 與 App 內建的下載邏輯使用**同一套過濾規則**（見 T10）

### 驗證
1. `node scripts/download-hkex.mjs` → `src/data/stock_universe.json` 生成
2. 輸出文件 `JSON.parse()` 不報錯
3. 記錄數 ≈ 2,600 ~ 3,200
4. 所有 `stock_code` 為 5 位數字字串
5. 無人民幣櫃台（尾號 8）的股票
6. 無衍生權證、牛熊證、債券

---

## T3 業務邏輯層

### 文件
`src/services/portfolioService.ts`

### 輸入
- T2 完成（db.ts 可調用）
- 需引入 `big.js`

### 輸出

| 函數 | 用途 |
|------|------|
| `formatStockCode(input: string): string` | 去空格、補零至 5 位（`700` → `00700`） |
| `toYahooCode(code: string): string` | 去掉**一個**前導零 + `.HK`（`00700` → `0700.HK`、`00005` → `0005.HK`）。v8 API 要求 4 位數字格式（保留至少一個前導零） |
| `searchStockUniverse(keyword: string): Promise<Stock[]>` | `WHERE stock_code LIKE '%' \|\| ? \|\| '%'` 任意位置匹配，限 20 條 |
| `addTransaction(tx: TxInput): Promise<void>` | 計算 cash_impact → 事務中寫入 transactions + 更新 cash_account |
| `deleteTransaction(id: number): Promise<void>` | 查 cash_impact → 事務中反向沖抵現金 + 物理刪除 |
| `calculatePositions(): Promise<{positions: Position[], cycleMap: Map<string,number>}>` | 全量重算持倉，返回當前持倉列表 + 持倉周期映射 |
| `batchFetchQuotes(): Promise<void>` | 批量拉 Yahoo v8 行情（僅用戶持倉），更新 stocks 表 |
| `syncStockListFromHKEX(): Promise<void>` | 從港交所下載 xlsx → 解析 → 過濾 → TRUNCATE + INSERT stock_universe |

### 約束

#### formatStockCode
- 輸入可為 1-5 位數字或含空格
- 去空格、去非數字字符、前方補 '0' 至 5 位

#### searchStockUniverse
- 匹配方式：`LIKE '%' || ? || '%'`（**任意位置**，非僅開頭）
- 限制返回 20 條
- keyword 為空時返回空數組

#### addTransaction（核心）
- **cash_impact 計算**：
  - BUY：`-(price × quantity + fee)` → 現金減少
  - SELL：`+(price × quantity - fee)` → 現金增加
  - DIVIDEND：`+(price - fee)` → 現金增加（price 存分紅總額，fee 存扣稅）
- **事務包裹**：INSERT transactions + UPDATE cash_account
- **行情緩存**：若 stocks 表無此股票，先 INSERT stocks（名稱從 stock_universe 查，若無則留空或用代碼）
- 所有數學運算強制使用 `big.js`

#### deleteTransaction
- 事務包裹：反向對沖現金 + DELETE transactions
- 不級聯刪除 stocks（其他流水可能引用）

#### calculatePositions（核心）
- 排序：`ORDER BY trade_date ASC, created_at ASC, id ASC`（id 為最終 tiebreaker）
- 遍歷規則：
  - BUY：quantity += 買入量，totalCost += (price × qty + fee)
  - SELL：股數減少，若歸零 → 成本重置為 0；未歸零 → totalCost = 賣出前均價 × 殘餘股數
  - DIVIDEND：股數不變，totalCost -= (price - fee)（除權），允許負數
- **positionCycleMap**：記錄每隻股票當前周期起始 transaction.id
  - 股數歸零 → 刪除該股票的 cycle 記錄
  - 再次 BUY → 記錄該 BUY 的 id 為新周期起點
- 返回僅 `quantity > 0` 的持倉（市值降序排列）

#### batchFetchQuotes（注意：Yahoo v7 已下線，v8 需逐隻請求）
- 端點：`https://query1.finance.yahoo.com/v8/finance/chart/{code}?interval=1d&range=1d`
  - `{code}` 格式為 `toYahooCode()` 輸出，如 `0700.HK`
- **請求策略**：從 stocks 表讀所有代碼 → toYahooCode → **逐隻請求**（每隻股票一個 HTTP 請求）
- **並發控制**：使用延遲隊列
  - 請求間隔 ≥ 200ms（避免被 Yahoo 限流封 IP）
  - 最大並發數 ≤ 3（同一時間最多 3 個未完成的請求）
  - 任一請求失敗不影響其他請求繼續
- **響應解析**：從 `chart.result[0].meta` 提取：
  - `regularMarketPrice` → stocks.current_price
  - `previousClose` → stocks.yesterday_close（注意：v8 欄位名為 `previousClose` 而非 v7 的 `regularMarketPreviousClose`）
  - `longName` 或 `shortName` → stocks.stock_name（若現有名稱為空則更新）
- 每隻股票成功返回後**立即** UPDATE 該股票的 stocks 記錄（不等其他請求）
- 單隻失敗：保留該股票舊緩存數據，不覆蓋
- 全部請求完成後（無論部分成功與否），觸發 `refreshPortfolioData()`
- 若**所有**股票全部失敗 → Toast「刷新失敗，請檢查網絡」；若有任何一隻成功 → Toast「行情已刷新」
- **API 降級**：請求失敗（超時/HTTP 錯誤/格式異常）時保留 stocks 表緩存數據，不阻塞本地功能

#### syncStockListFromHKEX
- **數據源**：港交所官方證券名單 `ListOfSecurities_c.xlsx`
- **下載**：`uni.downloadFile(url)` → 取得 `.xlsx` 文件的 temp file path
- **解析**：使用 SheetJS (`xlsx` npm 包) 讀取 ArrayBuffer → 提取行數據
- **過濾規則**（與 T2d 腳本完全一致）：
  - 保留：分類為「股本」「交易所買賣產品」「房地產投資信託基金」
  - 排除：衍生權證、牛熊證、債券、股本權證
  - 排除：人民幣櫃台（代碼尾號為 `8`）
- **導入**：`TRUNCATE stock_universe` + 批量 INSERT（每 500 條一個事務）
- **完成後**：Toast「股票列表已更新，共 N 隻」+ 刷新模糊搜索可用性
- **失敗降級**：任何步驟失敗 → 保留 stock_universe 現有數據不變 → Toast「更新失敗，請稍後重試」
- **依賴**：`xlsx` 庫僅在後台管理頁懶加載（不影響主流程體積）

**SheetJS 解析實現**：

```typescript
// 動態導入（僅在調用時加載，不影響主流程）
async function parseHKEXSecuritiesList(filePath: string): Promise<StockInfo[]> {
  const XLSX = await import('xlsx');

  // 讀取文件（App: uni.getFileSystemManager().readFile；H5: fetch ArrayBuffer）
  const buffer = await readFileAsArrayBuffer(filePath);
  const workbook = XLSX.read(buffer, { type: 'array' });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // 修復合併單元格導致的 !ref 不準確
  const keys = Object.keys(sheet).filter(k => !k.startsWith('!'));
  let maxRow = 0;
  keys.forEach(k => {
    const match = k.match(/([A-Z]+)(\d+)/);
    if (match) maxRow = Math.max(maxRow, parseInt(match[2]));
  });
  sheet['!ref'] = `A1:R${maxRow}`;

  // 轉為行數組
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];

  const stocks: StockInfo[] = [];
  const EXCLUDE_CATEGORIES = ['衍生權證', '牛熊證', '債券', '股本權證', '股本權證(主板)', '股本權證(創業板)'];
  const INCLUDE_CATEGORIES = ['股本', '交易所買賣產品', '房地產投資信託基金'];

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();

    if (!code || !name) continue;
    if (!INCLUDE_CATEGORIES.includes(category)) continue;
    if (EXCLUDE_CATEGORIES.includes(category)) continue;

    // 排除人民幣櫃台（代碼尾號為 8，且排除 5 位純數字中以 8 結尾的）
    // 注意：不是所有尾號 8 的都是人民幣櫃台（如 00008 不是），需要結合 HKEX 分類判斷
    // 但 HKEX xlsx 中 R 類股票通常是 5 位數字且尾號為 8（如 89988）
    const codeNum = code.padStart(5, '0');
    if (codeNum.length === 5 && codeNum[4] === '8') {
      // 檢查是否為 R 類櫃台：主板中 8xxxx 或尾號 8 且名稱含「－Ｒ」或「－WR」
      if (name.includes('－Ｒ') || name.includes('－WR') || name.includes('－R')) continue;
    }

    stocks.push({
      stock_code: codeNum,
      stock_name: name,
    });
  }

  return stocks.sort((a, b) => a.stock_code.localeCompare(b.stock_code));
}
```

### 驗證
1. `formatStockCode('700')` → `'00700'`
2. `toYahooCode('00700')` → `'0700.HK'`
3. 買入 1000 股 @ 10.00 + 費 50 → quantity=1000, totalCost=10050, 均價=10.05
4. 分紅 5000, 扣稅 200 → quantity 不變, totalCost 減少 4800
5. 股數歸零後 → 成本重置，cycleMap 記錄清除
6. 清倉後再買 → cycleMap 記錄新周期 id

---

## T4 全局狀態層

### 文件
`src/hooks/usePortfolio.ts`

### 輸入
- T3 完成（portfolioService.ts 可調用）

### 輸出

| 導出 | 類型 | 用途 |
|------|------|------|
| `totalAsset` | `Ref<string>` | 總資產 |
| `totalMarketValue` | `Ref<string>` | 總市值（新增） |
| `todayProfit` | `Ref<string>` | 今日盈虧 |
| `todayReturnRate` | `Ref<string>` | 今日收益率 %（新增） |
| `totalProfit` | `Ref<string>` | 累計盈虧 |
| `totalReturnRate` | `Ref<string>` | 累計收益率 %（新增） |
| `realizedProfit` | `Ref<string>` | 已實現盈虧 |
| `netInvested` | `Ref<string>` | 淨投入 |
| `availableCash` | `Ref<string>` | 可用現金 |
| `lastQuoteUpdateTime` | `Ref<string>` | 行情更新時間 HH:MM:SS。從 `SELECT MAX(updated_at) FROM stocks` 推導（持久化來源，非純內存）。stocks 為空時顯示空字串 |
| `positionList` | `Ref<Position[]>` | 持倉列表（每項含佔比/漲跌幅/個股今盈/個股盈虧%） |
| `isLoading` | `Ref<boolean>` | 全局加載鎖 |
| `refreshPortfolioData()` | `() => Promise<void>` | 刷新全部數據（本地計算） |
| `refreshMarketQuotes()` | `() => Promise<void>` | 刷新行情（網路請求） |
| `sortPositions(key)` | `(key: string) => void` | 切換排序方式（新增） |

### 約束
- 全局 Ref 定義在 **模組頂部函數外部**（單例模式）
- `refreshPortfolioData()`：
  - 讀取 availableCash
  - 調用 `calculatePositions()` 獲取 positions + cycleMap
  - 計算總市值 totalMarketValue = Σ(current_price × quantity), quantity > 0
  - 計算 totalAsset = availableCash + totalMarketValue
  - 計算 netInvested（遍歷全部 transactions）
  - 計算 totalProfit = totalAsset - netInvested
  - 計算 unrealizedProfit = Σ(quantity > 0 的 市值 - 除權後總成本)
  - 計算 **realizedProfit = totalProfit - unrealizedProfit**（總量減法）
  - 計算 todayProfit = Σ((current_price - yesterday_close) × quantity), 僅 quantity > 0
  - 計算 **todayReturnRate = todayProfit / totalMarketValue × 100%**（totalMarketValue 為 0 時返回 '0.00%'）
  - 計算 **totalReturnRate = totalProfit / netInvested × 100%**（netInvested 為 0 時返回 '0.00%'）
  - 為每個持倉計算額外字段：
    - **佔比%** = 個股市值 / totalMarketValue × 100%（保留一位小數）
    - **漲跌幅%** = (current_price - yesterday_close) / yesterday_close × 100%
    - **個股今日盈虧** = (current_price - yesterday_close) × quantity
    - **個股盈虧%** = (marketValue - totalCost) / totalCost × 100%
  - 計算 **lastQuoteUpdateTime**：`SELECT MAX(updated_at) FROM stocks` → 格式化為 `HH:MM:SS`
    - 若 stocks 表為空 → 設為空字串 `''`（視圖層顯示 "—"）
    - 此欄位**從數據庫推導**（非純內存），App 重啟後自動恢復
  - 更新所有 Ref
  - 市值格式化邏輯在 T5（視圖層）處理
- `refreshMarketQuotes()`：
  - 檢查 isLoading 鎖
  - stocks 表為空 → Toast "暫無股票數據，請先錄入交易" → 不請求
  - 調用 batchFetchQuotes() → 成功後調 refreshPortfolioData()
  - isLoading 保護（true 期間禁止重複觸發）
- `positionList` 包含 `cycleMap` 信息，供 tx-popup 使用

### 驗證
1. 初始狀態：totalAsset = '0.00', 所有 profit = '0.00', positionList = []
2. 錄入一筆交易後 → refreshPortfolioData → 所有 Ref 更新
3. isLoading 鎖正常運作（快速連點保護）
4. 多個頁面共享同一份 Ref（值同步）

---

## T5 資產持倉大盤頁

### 文件
`src/pages/index/index.vue`

### 輸入
- T4 完成（usePortfolio 可用）

### 功能點

#### 看板區 (.asset-card)
按四層級展示，深藍漸變底，所有文字白色系（參見 ui-design.md §2.2）：
- **L1**：標籤「總資產 (HKD)」+ 大字數字（56rpx 粗體）
- **L2**：左「總市值」+ 右「可用現金」並排（28rpx），現金為負時紅字
- **L3**：三行盈虧指標，每行兩個並排：
  - 「今日盈虧」+「今日收益率」（32rpx，紅漲綠跌）
  - 「累計盈虧」+「累計收益率」（32rpx，紅漲綠跌）
  - 「已實現盈虧」+「淨投入」（28rpx，顏色略降級為輔助信息）
- **L4**：「行情更新：HH:MM:SS」時間戳（18rpx）
- 右上角兩個圖標按鈕：🔄 同步行情 + ⚙️ 後台管理

#### 🔄 同步行情
- 點擊 → 旋轉動畫 + `refreshMarketQuotes()` → 成功 Toast「行情已刷新」 / 失敗 Toast「刷新失敗，請檢查網絡」
- stocks 表為空時：Toast「暫無股票數據，請先錄入交易」
- 刷新完成後自動觸發 `refreshPortfolioData()`（無需單獨的重算按鈕）

#### 後台管理入口
- ⚙️ 後台管理：點擊 → `uni.navigateTo('/pages/admin/admin')`
- 用於更新股票列表、管理數據等非日常操作

#### 持倉列表區
- 僅展示 `quantity > 0`
- **排序**：預設市值降序。表頭可點擊切換排序方式（市值 / 盈虧額 / 佔比）
- **每行佈局**（3 行，約 140rpx，參見 ui-design.md §2.3）：
  - **Row 1**：左「代碼（32rpx Courier 粗體）+ 名稱（22rpx 灰）」，右「佔比%（24rpx 灰）」
  - **Row 2**（三列）：
    - 左：現價（28rpx 粗體）+ 漲跌幅%（24rpx）
    - 中：盈虧額（28rpx 粗體）+ 盈虧%（24rpx）
    - 右：持股數（28rpx）
  - **Row 3**（三列，灰小字 22rpx）：
    - 左：持倉均價
    - 中：個股今日盈虧
    - 右：總市值
- **顏色規則**：
  - 現價 ≥ 昨收 → 紅，< 綠；漲跌幅% 跟隨現價方向
  - 盈虧額/盈虧%：市值 ≥ 除權後總成本 → 紅，< 綠；除權後成本 < 0（完全回本）→ 紅
  - 個股今日盈虧：跟隨當日漲跌方向
- **市值格式**：> 100 萬 → `XXX.X萬`；> 1 億 → `X.XX億`；否則精確到小數點兩位
- **佔比**：保留一位小數
- 點擊行 → 打開 tx-popup 彈窗，傳入 stock_code 和 cycleStartId

#### 底部快捷按鈕
- 【買賣股票】（紅色 `#fa4d56`）→ `navigateTo /pages/trade/trade`
- 【錄入分紅】（琥珀金 `#f1c40f`）→ `navigateTo /pages/dividend/dividend`

#### 空狀態
- 無持倉時：📊 暫無持倉 + 引導文字

#### 生命週期
- `onShow` → `refreshPortfolioData()`
- `onPullDownRefresh` → `refreshPortfolioData()` + `uni.stopPullDownRefresh()`

### 約束
- 所有金額字段使用 `big.js` 格式後再顯示（`.toFixed(2)`）
- 看板背景：`linear-gradient(135deg, #1e3c72, #2a5298)`
- 等寬代碼：`.courier-bold-code`

### 驗證
1. 首次啟動 → 空狀態正常顯示
2. 買入後 → 看板數據正確，持倉列表出現
3. 點擊 🔄 → 行情刷新，按鈕旋轉
4. 下拉 → 觸發 `refreshPortfolioData()` + 停止下拉動畫
5. 點擊持倉行 → 彈窗打開

---

## T6 全量流水賬本頁

### 文件
`src/pages/history/history.vue`

### 輸入
- T4 完成（可查詢 transactions 全量數據）

### 功能點

#### 股票篩選器
- 頂部 **picker 下拉選擇器**（非 chips，因選項 > 8 個）
- 選項動態生成自所有有交易記錄的股票代碼 + 「全部」
- 預設選中「全部」

#### 流水列表
- 排序：`trade_date DESC, created_at DESC`
- **日期分組**（新增）：按**月份分組**顯示，每月一個區塊
  - 月份標題行：淺灰藍底色 `#f0f1f5`，顯示「YYYY年M月」+ 右側「共 N 筆」，高度 56rpx
  - 預設全部展開，可點擊折疊/展開（右側 ▼/▶ 圖標）
- 每行字段（單行，約 80rpx）：
  ```
  [MM-DD] [代碼 名稱] [🏷️BUY/SELL/DIV] [+1000/-500/—] [費 50.00] [💰+5,000.00]
  ```
  - 日期僅顯示 `MM-DD`，月份信息由分組標題提供
  - 網格參見 ui-design.md §3.3
- 類型標籤三色：`.badge-buy`（紅）/ `.badge-sell`（綠）/ `.badge-dividend`（金）
- 備註：若有 remark，行尾灰色小字顯示

#### 左滑刪除
- 使用 `uni-swipe-action` 組件
- 滑出紅色「刪除」按鈕（120rpx）
- 點擊 → `uni.showModal` 二次確認
- 確認 → `deleteTransaction(id)` → `refreshPortfolioData()` → 列表刷新

#### 長按刪除
- 長按 → `uni.showActionSheet` ["刪除", "取消"]
- 選擇「刪除」→ 同上二次確認

#### 空狀態
- 無交易 → 📋 暫無交易記錄 + 引導文字

#### 生命週期
- `onShow` → 重新查詢全量流水並渲染

### 約束
- 刪除後列表為空 → 顯示空狀態
- Filter 切換即時刷新列表

### 驗證
1. 錄入交易後 → 流水頁顯示該記錄
2. 左滑 → 出現刪除按鈕
3. 確認刪除 → Toast「已刪除」→ 列表更新 → 持倉頁數據同步刷新
4. picker 篩選 → 只顯示選中股票
5. 切回「全部」→ 恢復全量

---

## T7 股票買賣錄入頁

### 文件
`src/pages/trade/trade.vue`

### 輸入
- T3 完成（searchStockUniverse / addTransaction 可用）
- T4 完成（positionList 可用）

### 功能點

#### 買入/賣出 Tab
- 雙標籤切換（非 uni-app 原生 Tab，自己實現）
- 買入選中：紅色底線 `#fa4d56`，按鈕文案「確認買入」
- 賣出選中：綠色底線 `#24a148`，按鈕文案「確認賣出」
- **切換 Tab 保留已填表單內容**

#### 股票代碼模糊搜索
- 輸入 ≥1 位 → 調 `searchStockUniverse(keyword)` → 下拉列表
- 列表每行顯示「代碼 + 名稱」
- 選中 → 代碼自動格式化（`formatStockCode`）+ 名稱顯示
- 無匹配 → 提示「無匹配股票，可手動輸入代碼提交」
- 手動輸入 → 提交時格式校驗（必須 4-5 位數字）

#### 選中後顯示持倉資訊
- 從 positionList 中查找該股票
- 顯示：「當前持倉：X 股 | 持倉均價：XXX.XX」

#### 賣出校驗
- 賣出數量 > 持倉數 → 阻止 + Toast
- 賣出數量 == 持倉數 → 清倉確認彈窗

#### 表單校驗
| 字段 | 校驗 |
|------|------|
| 股票代碼 | 必須已選中或手動輸入 4-5 位純數字 |
| 數量 | > 0；賣出時 ≤ 持倉 |
| 單價 | > 0 |
| 手續費 | ≥ 0（可空，預設 0） |
| 交易日期 | ≤ 今天 |
| 備註 | 可空，最多 200 字 |

#### 提交流程
1. 校驗 → 按鈕「提交中...」+ 禁用
2. `addTransaction()` → 成功 → Toast → `refreshPortfolioData()` → 800ms 後 `navigateBack()`
3. 失敗 → Toast → 按鈕恢復

#### 傳參場景
- `?stock_code=00700` → 代碼自動填入，**不鎖定**（可修改）
- 有 stock_code 時 Tab 預設「買入」

#### 返回保護
- 表單有內容 → `uni.showModal`「丟棄當前輸入的內容？」→ 「繼續編輯」/「丟棄」
- 表單為空 → 直接返回

### 約束
- 所有金額計算用 `big.js`
- 提交按鈕 isLoading 鎖（禁止重複提交）

### 驗證
1. 輸入 `700` → 下拉顯示含 `700` 的股票
2. 選中 `00700 騰訊控股` → 代碼 + 名稱填入
3. 切换到賣出 → 表單內容保留
4. 賣出超過持倉 → 阻止 + Toast
5. 成功提交 → 返回 → 首頁數據已更新

---

## T8 分紅錄入頁

### 文件
`src/pages/dividend/dividend.vue`

### 輸入
- T3 完成（searchStockUniverse / addTransaction 可用）
- T4 完成（positionList 可用）

### 功能點

#### 股票代碼模糊搜索
- 與 T7 相同機制

#### 除權即時預覽（核心）
- 用戶輸入「分紅總額」和「扣稅/手續費」後，即時計算並顯示卡片：

  ```
  分紅淨額 = 分紅總額 - 扣稅/手續費
  除權後總成本 = 當前持倉總成本 - 分紅淨額
  除權後持倉均價 = 除權後總成本 ÷ 當前持股數量
  ```

- 預覽卡片：
  ```
  ┌─────────────────────────────┐
  │ 📌 實收分紅淨額：HKD 4,800.00   │
  │ 除權後持倉均價：315.50          │
  │ （原均價 320.50 ↓ 5.00）      │
  │ ⚠️ 持倉成本已完全回本（均價<0时）│
  └─────────────────────────────┘
  ```

#### 分紅屬性說明
- 灰色小字：「此操作不會改變您的持股數量。分紅淨額將加入可用現金，同時從持倉成本中扣除（除權）。」

#### 表單校驗
| 字段 | 校驗 |
|------|------|
| 股票代碼 | 必須已選中或手動輸入 4-5 位純數字 |
| 分紅總額 | > 0 |
| 扣稅/手續費 | ≥ 0（可空，預設 0）；**必須 < 分紅總額** |
| 除權日期 | ≤ 今天 |
| 備註 | 可空，最多 200 字 |

#### 提交 + 返回保護
- 與 T7 相同邏輯
- 提交按鈕琥珀金色（`#f1c40f`），文案「確認錄入分紅」

### 約束
- 除權後均價可為負數（綠色標註「已完全回本」）
- 所有計算用 big.js

### 驗證
1. 輸入分紅總額 5000、扣稅 200 → 預覽顯示分紅淨額 4800、除權後均價即時更新
2. 扣稅 ≥ 分紅總額 → 阻止提交
3. 提交成功 → 返回首頁 → 可用現金增加、持倉均價下降

---

## T9 個股歷史流水彈窗

### 文件
`src/components/tx-popup/tx-popup.vue`

### 輸入
- T4 完成（positionList 含 cycleMap）
- 可查詢 transactions 表

### Props
| Prop | 類型 | 說明 |
|------|------|------|
| `visible` | `boolean` | 控制顯示/隱藏 |
| `stockCode` | `string` | 當前股票代碼 |
| `cycleStartId` | `number \| null` | 當前持倉周期起始 transaction.id（來自 cycleMap） |

### Events
| Event | 說明 |
|-------|------|
| `@close` | 關閉彈窗 |
| `@navigateTrade` | 跳轉交易頁，攜帶 stock_code |
| `@navigateDividend` | 跳轉分紅頁，攜帶 stock_code |

### 功能點

#### 彈窗頭部
- 等寬大字代碼 + 名稱
- 持倉匯總（從 positionList 獲取）：
  - 持倉 X 股 | 持倉均價 XXX.XX
  - 成本盈虧 = 當前市值 - **除權後持倉總成本**（紅/綠）

#### 流水明細列表
- 滾動區域（`max-height: 55vh`）
- 查詢 SQL：`WHERE stock_code = ? AND id >= ?`（第二個 ? 為 cycleStartId，實現周期隔離）
- 排序：`trade_date DESC, created_at DESC`
- 每行字段（6 項，頭部已顯示代碼+名稱，行內省略）：
  ```
  [日期] [🏷️類型] [+1000/—] [@ 10.50] [費 50.00] [💰+5,000.00]
  ```

#### 底部快捷按鈕
- 【去交易】（紅色）→ `@navigateTrade`，攜帶 `?stock_code=XXXXX`
- 【錄入此股分紅】（琥珀金）→ `@navigateDividend`，攜帶 `?stock_code=XXXXX`

#### 關閉方式
- 點擊遮罩層
- 點擊右上角 ✕
- 點擊快捷按鈕（先關閉再跳轉）

#### 數據刷新
- 每次 `visible` 變為 true → 重新查詢該股票 transactions

### 約束
- 底部彈窗動畫（從底部平滑滑出）
- 遮罩層：`rgba(0,0,0,0.5)`
- 清倉後股票不在持倉列表顯示，用戶無法點擊打開彈窗（由 index.vue 保證）
- 快捷按鈕點擊後：先 `$emit('close')` → 再 `navigateTo`

### 驗證
1. 點擊持倉行 → 彈窗滑出，顯示該股票流水
2. 頭部顯示持倉匯總 + 成本盈虧
3. 流水列表只顯示當前周期
4. 點擊「去交易」→ 彈窗關閉 → 跳轉 trade 頁，代碼預填
5. 點擊遮罩 → 彈窗關閉

---

## T10 後台管理頁 (`pages/admin/admin.vue`)

### 文件
`src/pages/admin/admin.vue`

### 輸入
- T2 完成（db.ts 可調用）
- T3 完成（syncStockListFromHKEX 可用）

### 功能點

#### 頁面定位
- 非 TabBar 頁面，從首頁右上角**齒輪圖標** ⚙️ 進入（`navigateTo`）
- 導航欄左側自帶 ← 返回按鈕（uni-app `navigateTo` 默認行為），點擊返回首頁
- 頁面頂部顯示標題「數據管理」
- 不屬於日常交易流程，獨立於主要頁面之外

#### 股票列表管理區
- 顯示當前 stock_universe 狀態：
  - 收錄股票數：`SELECT COUNT(*) FROM stock_universe`
  - 上次更新時間：`SELECT MAX(applied_at) FROM schema_version WHERE version = 1`
- **【從港交所更新股票列表】**按鈕（主操作）
  - 點擊 → `syncStockListFromHKEX()`（見 T3）
  - 下載中 → 按鈕顯示「下載中...」+ 進度條（`uni.downloadFile` 支援 onProgressUpdate）
  - 解析中 → 「正在解析...」
  - 導入中 → 「正在更新本地數據...」
  - 成功 → Toast「股票列表已更新，共 N 隻」
  - 失敗 → Toast「更新失敗，請稍後重試」
- **【從本地文件導入】**按鈕（備用方案）
  - 使用 `uni.chooseFile` 選擇本地 `.xlsx` 或 `.json` 文件
  - 解析並導入（與上述流程相同）

#### 日誌顯示區
- 顯示上次更新的簡單日誌：
  - 更新時間
  - 新增/移除數量對比（需在 syncStockListFromHKEX 中記錄 diff）

#### 約束
- `xlsx` 庫懶加載：僅在用戶打開此頁面時動態 `import('xlsx')`，不影響主流程
- 更新過程中禁止退出頁面（`uni.showLoading` + 返回攔截）
- 所有操作為純本地（下載除外），不涉及服務端

### 驗證
1. 點擊「從港交所更新」→ 下載成功 → stock_universe 記錄更新
2. 更新後 → 返回交易頁 → 模糊搜索可找到新股
3. 網路斷開時點擊更新 → Toast「當前處於離線狀態」→ 現有數據保留
4. xlsx 解析失敗（文件格式異常）→ Toast「文件格式異常」→ 現有數據保留

---

## 任務狀態

| ID | 任務 | 狀態 | 備註 |
|----|------|------|------|
| T1 | 項目腳手架 | ⬜ pending | package.json, pages.json, App.vue, uni.scss 等 |
| T2.1 | DDL 建表與索引 | ⬜ pending | 5 張表 + 3 個索引 |
| T2.2 | 數據庫連接與環境降級 | ⬜ pending | plus.sqlite Promise 化 + H5 Memory Mock |
| T2.3 | 現金賬戶初始化 | ⬜ pending | id=1, available_cash='0.00' |
| T2.4 | stock_universe 初始化導入 | ⬜ pending | JSON → SQLite，每 500 條一個事務 |
| T2.5 | stock_universe 同步更新 | ⬜ pending | TRUNCATE + INSERT 覆蓋 |
| T2b | 股票主數據 JSON | ⬜ pending | ~2500+ 港股代碼 + 名稱 |
| T2c | 數據庫種子腳本 | ⬜ pending | init-db.mjs，依賴 T2b |
| T2d | 港股列表下載腳本 | ⬜ pending | download-hkex.mjs，從港交所下載 |
| T10 | 後台管理頁 | ⬜ pending | admin.vue，股票列表更新 + 本地文件導入 |
| T3 | 業務邏輯層 | ⬜ pending | portfolioService.ts，依賴 T2 |
| T4 | 全局狀態層 | ⬜ pending | usePortfolio.ts，依賴 T3 |
| T5 | 資產持倉大盤頁 | ⬜ pending | index.vue，依賴 T4 |
| T6 | 全量流水賬本頁 | ⬜ pending | history.vue，依賴 T4 |
| T7 | 股票買賣錄入頁 | ⬜ pending | trade.vue，依賴 T3, T4 |
| T8 | 分紅錄入頁 | ⬜ pending | dividend.vue，依賴 T3, T4 |
| T9 | 個股歷史流水彈窗 | ⬜ pending | tx-popup.vue，依賴 T4 |
