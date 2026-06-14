# 港股持倉管理系統 — 編碼規範與品質約束

> 本文檔合併了原 spec.md §7-§14 和 skills.md，是 AI 編碼時必須遵守的規則集合。

---
## 7. 錯誤處理策略 (Error Handling Strategy)

### 7.1 錯誤分類 (Error Taxonomy)

```typescript
/** 錯誤類型枚舉 */
enum ErrorType {
  VALIDATION = 'VALIDATION',   // 用戶輸入校驗失敗 → 內聯提示，不 Toast
  DATABASE  = 'DATABASE',      // SQLite 操作失敗 → Toast + 日誌
  NETWORK   = 'NETWORK',       // Yahoo API 請求失敗 → Toast，保留緩存
  BUSINESS  = 'BUSINESS',      // 業務規則違反 → Toast，阻止操作
}

/** 統一錯誤對象 */
class AppError extends Error {
  type: ErrorType;
  userMessage: string;      // 可展示給用戶的文案
  originalError?: unknown;  // 原始異常（用於日誌）
  context?: string;         // 額外上下文（如 SQL 語句、API URL）
}
```

### 7.2 四層錯誤傳播鏈

```
┌─────────────────────────────────────────────────────────┐
│  View 層 (pages/*)                                       │
│  - 表單校驗錯誤：攔截 ErrorType.VALIDATION → 內聯提示     │
│  - 操作錯誤：接收 Hook 的 error Ref → uni.showToast       │
│  - 禁止 throw 到框架層（uni-app 不安裝全局錯誤邊界）      │
├─────────────────────────────────────────────────────────┤
│  Hook 層 (usePortfolio.ts)                ← 最後捕獲點   │
│  - catch Service 層所有異常                                │
│  - 寫入 error Ref（View 響應式綁定）                       │
│  - 寫入日誌（調用 logger）                                 │
│  - 釋放 isLoading 鎖                                      │
│  - 禁止向上 throw（View 不應崩潰）                         │
├─────────────────────────────────────────────────────────┤
│  Service 層 (portfolioService.ts)                         │
│  - 校驗輸入 → throw new AppError(VALIDATION, ...)         │
│  - DB 錯誤 → catch, 包裝為 AppError(DATABASE, ...), throw │
│  - 網路錯誤 → catch, 包裝為 AppError(NETWORK, ...), throw │
│  - 業務規則 → throw new AppError(BUSINESS, ...)           │
├─────────────────────────────────────────────────────────┤
│  DB 層 (db.ts)                                            │
│  - 原生 SQLite 錯誤 → 直接 throw（不包裝）                 │
│  - sql.js 錯誤 → 直接 throw                               │
│  - 不在 DB 層 catch（留給 Service 層包裝語義）             │
└─────────────────────────────────────────────────────────┘
```

### 7.3 各層錯誤處理規範

#### DB 層 (`db.ts`)

| 場景 | 行為 |
|------|------|
| `executeSql` 失敗 | 直接 throw 原始錯誤（SQLite 錯誤碼 + 訊息） |
| `selectSql` 失敗 | 直接 throw |
| `runInTransaction` 中 fn 拋錯 | 自動 ROLLBACK → throw（不包裝） |
| 數據庫未初始化 | throw `new Error('[DB] Database not initialized. Call initDatabase() first.')` |
| H5 環境 sql.js 加載失敗 | throw `new Error('[DB] sql.js WASM failed to load. Check network or sql.js dependency.')` |

#### Service 層 (`portfolioService.ts`)

| 場景 | ErrorType | userMessage | 額外處理 |
|------|-----------|-------------|----------|
| 股票代碼格式無效 | VALIDATION | "請輸入有效的港股代碼（4-5 位數字）" | — |
| 交易數量 ≤ 0 | VALIDATION | "請輸入有效的交易數量" | — |
| 賣出超持倉 | BUSINESS | "賣出數量超過當前持倉（{n} 股）" | — |
| 清倉確認未通過 | — | — | 不拋錯，直接 return（用戶取消） |
| DB 寫入失敗 | DATABASE | "數據保存失敗，請重試" | 記錄 SQL + params |
| 事務回滾 | DATABASE | "操作失敗，數據已回滾" | 記錄完整 error stack |
| Yahoo API 超時 | NETWORK | "行情刷新失敗，請檢查網絡" | 保留緩存數據 |
| Yahoo API 401/403 | NETWORK | "行情服務暫時不可用" | 記錄 HTTP status |
| Yahoo API 返回空 | NETWORK | "行情數據異常，請稍後重試" | 記錄原始響應 |
| 刪除不存在 ID | — | — | 不拋錯，console.warn |

#### Hook 層 (`usePortfolio.ts`)

```typescript
// 統一的 Service 調用包裝
async function safeCall<T>(
  fn: () => Promise<T>,
  action: string  // '刷新行情' | '提交交易' | '刪除交易' 等
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    const appErr = e instanceof AppError ? e
      : new AppError(ErrorType.DATABASE, `${action}失敗，請重試`, e);

    // 寫入日誌
    logger.error(`[${appErr.type}] ${action}: ${appErr.userMessage}`, appErr.originalError);

    // 通知 View
    uni.showToast({ title: appErr.userMessage, icon: 'none' });

    return null;  // 不崩潰，返回 null 表示失敗
  } finally {
    isLoading.value = false;  // 無論成功失敗都釋放鎖
  }
}
```

#### View 層 (`pages/*`)

| 場景 | 行為 |
|------|------|
| 表單字段校驗失敗 | 字段邊框變紅 + `.input-error-hint` 顯示提示文字（不 Toast） |
| 提交操作失敗 | Hook 層已 Toast，View 層無需額外處理 |
| 行情刷新失敗 | Hook 層已 Toast，View 層保留上次數據顯示 |
| 頁面卸載後異步回調 | 檢查 `getCurrentPages()` 防止在已離開的頁面上操作 |

### 7.4 Toast 提示文案規範

| 操作 | 成功文案 | 失敗文案 |
|------|----------|----------|
| 買入 | 「買入成功」 | 「買入失敗，請重試」 |
| 賣出 | 「賣出成功」 | 「賣出失敗，請重試」 |
| 錄入分紅 | 「分紅已錄入」 | 「分紅錄入失敗，請重試」 |
| 刪除交易 | 「已刪除」 | 「刪除失敗，請重試」 |
| 刷新行情 | 「行情已刷新」 | 「刷新失敗，請檢查網絡」 |
| 同步市場數據 | 「市場數據已更新」 | 「同步失敗，請稍後重試」 |

### 7.5 日誌系統設計

#### 7.5.1 日誌等級（嚴重性從低到高）

| 等級 | 數值 | 使用場景 | 示例 |
|------|:--:|------|------|
| `TRACE` | 0 | 函數進入/退出、循環迭代、變量賦值 | `[TRACE] calculatePositions() 開始遍歷，共 150 條流水` |
| `DEBUG` | 1 | SQL 語句、API 請求 URL、計算中間步驟 | `[DEBUG] executeSql: INSERT INTO transactions VALUES (?,?,...)` |
| `INFO` | 2 | 關鍵操作成功、狀態變更 | `[INFO] 買入 00700 成功，id=42` |
| `WARN` | 3 | 可恢復異常、降級行為 | `[WARN] 09988 行情刷新失敗 (timeout)，使用緩存` |
| `ERROR` | 4 | 不可恢復異常、事務回滾 | `[ERROR] 事務回滾: INSERT transactions 失敗` |
| `FATAL` | 5 | App 無法繼續運行 | `[FATAL] initDatabase() 失敗，數據庫無法創建` |

#### 7.5.2 日誌級別配置

配置文件 `src/config/log.config.ts`——系統中**唯一的日誌配置**。App 和 H5 共用同一份配置，根據運行環境自動選擇對應的等級組。

```typescript
// src/config/log.config.ts

export const LOG_CONFIG = {
  // H5 開發模式：DEBUG 及以上全部輸出
  // 你在桌面上調試時可以看到 SQL 語句、API URL、計算步驟
  development: ['debug', 'info', 'warn', 'error', 'fatal'] as const,

  // App 生產模式：只記錄 ERROR 和 FATAL
  // 手機上只保存真正的異常，不堆積調試信息
  production: ['error', 'fatal'] as const,

  // vitest 測試模式：WARN 及以上
  // 測試時關注異常但不淹沒測試輸出
  test: ['warn', 'error', 'fatal'] as const,

  // 每次啟動清空當天舊日誌，重新開始
  // 設為 true：啟動時 truncate 當天的日誌文件（不留歷史）
  // 設為 false：追加寫入（H5 開發時方便看歷史）
  clearOnStartup: true,

  // 日誌文件保留天數（僅 App 模式生效）
  // 超過此天數的日誌文件自動刪除
  maxDays: 7,
};

/** 根據環境獲取當前啟用的日誌等級 */
export function getActiveLogLevels(): readonly string[] {
  // H5 開發模式
  if (typeof window !== 'undefined' && typeof plus === 'undefined') {
    return LOG_CONFIG.development;
  }
  // vitest 測試模式
  if (typeof process !== 'undefined' && process.env?.VITEST) {
    return LOG_CONFIG.test;
  }
  // App 生產模式 (plus.sqlite)
  return LOG_CONFIG.production;
}
```

**規則**：
- 修改日誌級別**只需編輯這一個文件**
- `development` / `production` / `test` 三個數組獨立配置，互不干擾
- 用戶不需要手動切換——系統根據運行環境自動選擇
- H5 開發時看到 DEBUG，手機上只記錄 ERROR，測試時只看 WARN

#### 7.5.3 日誌格式

每條日誌的統一格式：

```
[YYYY-MM-DD HH:MM:SS] [LEVEL] [MODULE] 消息內容 | {關鍵上下文}
```

| 字段 | 說明 | 示例 |
|------|------|------|
| 時間戳 | 本地時間，精確到秒 | `2026-06-14 21:30:45` |
| 等級 | 大寫，固定 5 字符寬 | `ERROR` |
| 模塊 | 產生日誌的代碼模塊 | `portfolioService`, `db`, `usePortfolio` |
| 消息 | 中文描述 | `事務回滾: INSERT transactions 失敗` |
| 上下文 | JSON 格式，可選 | `{"error":"SQLITE_CONSTRAINT","code":"00700"}` |

**完整示例**：
```
[2026-06-14 21:30:45] [ERROR] [portfolioService] 事務回滾: INSERT transactions 失敗 | {"error":"SQLITE_CONSTRAINT","code":"00700"}
[2026-06-14 21:30:46] [INFO] [usePortfolio] 行情刷新完成，更新 12 隻股票，耗時 3.2s
[2026-06-14 21:30:46] [DEBUG] [db] executeSql: UPDATE stocks SET current_price=?, yesterday_close=? WHERE stock_code=?
[2026-06-14 21:31:00] [WARN] [portfolioService] 09988 行情刷新失敗 (timeout)，使用緩存價格
[2026-06-14 21:31:00] [FATAL] [App] initDatabase() 失敗 | {"message":"sql.js WASM 加載失敗","stack":"..."}
```

#### 7.5.4 Logger 實現

統一通過 `src/utils/logger.ts` 輸出日誌，禁止在業務代碼中直接使用 `console.log`。

```typescript
// src/utils/logger.ts

import { getActiveLogLevels, LOG_CONFIG } from '@/config/log.config';

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
};

let initialized = false;

class Logger {
  private module: string;
  private enabledLevels: Set<LogLevel>;
  private buffer: string[] = [];  // 初始化前的緩衝區

  constructor(module: string) {
    this.module = module;
    this.enabledLevels = new Set(getActiveLogLevels() as LogLevel[]);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.enabledLevels.has(level)) return;

    const timestamp = new Date().toLocaleString('zh-HK', { hour12: false });
    const ctx = context ? ` | ${JSON.stringify(context)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${this.module}] ${message}${ctx}`;

    // Console 始終輸出（開發時即時可見；生產環境 ERROR/FATAL 在 console 也能看到）
    const consoleFn = level === 'fatal' ? console.error
      : level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : level === 'info' ? console.info
      : console.debug;
    consoleFn(line);

    // 寫入日誌文件
    this.writeToFile(line);
  }

  private writeToFile(line: string): void {
    if (!initialized) {
      this.buffer.push(line);  // 初始化未完成時先緩衝
      return;
    }

    // H5: POST /api/log → Vite 中間件寫入 logs/server-YYYY-MM-DD.log
    if (typeof window !== 'undefined' && typeof plus === 'undefined') {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      }).catch(() => {});
    }

    // App: 寫入 _doc/logs/app-YYYY-MM-DD.log
    if (typeof plus !== 'undefined') {
      // plus.io 異步寫入
    }
  }

  // 初始化完成後釋放緩衝
  static flush(): void {
    initialized = true;
    // 遍歷所有 Logger 實例，寫出緩衝的日誌
  }

  trace(msg: string, ctx?: Record<string, unknown>) { this.log('trace', msg, ctx); }
  debug(msg: string, ctx?: Record<string, unknown>) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.log('error', msg, ctx); }
  fatal(msg: string, ctx?: Record<string, unknown>) { this.log('fatal', msg, ctx); }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}
```

#### 7.5.5 啟動時清空舊日誌

在 `App.vue onLaunch` 中，`initDatabase()` 成功後立即調用日誌初始化：

```typescript
// App.vue
import { createLogger } from '@/utils/logger';
import { LOG_CONFIG } from '@/config/log.config';

const logger = createLogger('App');

export default {
  async onLaunch() {
    try {
      await db.initDatabase();
      
      // 日誌系統初始化：清空當天舊日誌
      if (LOG_CONFIG.clearOnStartup) {
        await clearTodayLog();
      }
      
      logger.info('App 啟動完成');
    } catch (e) {
      logger.fatal('initDatabase() 失敗', { message: String(e) });
      // 顯示錯誤頁面
    }
  }
};

/** 清空當天的日誌文件 */
async function clearTodayLog(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  
  // H5: 通過 Vite API 清空
  if (typeof window !== 'undefined' && typeof plus === 'undefined') {
    await fetch('/api/log/clear', { method: 'POST', body: JSON.stringify({ date: today }) });
  }
  
  // App: truncate 文件
  if (typeof plus !== 'undefined') {
    // plus.io 獲取文件句柄 → truncate(0)
  }
}
```

**效果**：
- 每次打開 App → 當天的舊日誌被清空 → 從零開始寫
- 歷史日誌（昨天及之前）保留，但最多保留 `maxDays` 天
- App 不會因長期使用而堆積大量日誌文件

#### 7.5.6 日誌文件管理

| 項目 | 規則 |
|------|------|
| 文件名 | H5: `logs/server-YYYY-MM-DD.log`；App: `_doc/logs/app-YYYY-MM-DD.log` |
| 啟動行為 | 每次啟動**清空當天日誌**（`clearOnStartup: true`），從零開始寫 |
| 歷史保留 | 昨天及之前的日誌保留，最多 `maxDays` 天後自動刪除 |
| 按天分文件 | 跨天自動切換新文件 |
| App 端體積 | 生產模式僅記錄 ERROR/FATAL，日誌量極小。每個錯誤約 200 bytes，即使 100 個錯誤也才 20KB |
| 文件位置 | H5: 項目根目錄 `logs/`；App: 沙盒 `_doc/logs/` |

#### 7.5.6 全局異常捕獲

在 `App.vue` 中安裝全局異常處理器，確保未捕獲的異常至少寫入日誌：

```typescript
// App.vue onLaunch
const logger = createLogger('App');

// 同步異常
window.addEventListener('error', (event) => {
  logger.fatal('未捕獲異常', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
  });
});

// Promise 異常
window.addEventListener('unhandledrejection', (event) => {
  logger.fatal('未處理的 Promise 拒絕', {
    reason: String(event.reason),
  });
});
```

#### 7.5.7 隱私保護規則

| 允許記錄 | 禁止記錄 |
|----------|----------|
| 股票代碼 | 交易數量 |
| 操作類型 (BUY/SELL/DIVIDEND) | 交易單價 |
| 錯誤訊息 | 手續費金額 |
| SQL 語句（帶 `?` 佔位符，不帶參數值） | 現金餘額 |
| API URL | 持倉總市值 |
| 操作耗時 | 任何可推算出用戶資產規模的數據組合 |

**原因**：日誌文件可能被備份到 iCloud/Google Drive 或通過系統分享功能洩露。不記錄金額確保即使日誌文件外洩，用戶的財務隱私不受影響。

---


---
## 8. 離線優先架構 (Offline-First Architecture)

### 8.1 功能聯網依賴矩陣

| 功能 | 聯網依賴 | 離線行為 | 聯網時增強 |
|------|:--:|------|------|
| **交易錄入** (BUY/SELL) | ❌ 無 | 完全正常使用 | — |
| **分紅錄入** (DIVIDEND) | ❌ 無 | 完全正常使用 | — |
| **交易刪除** | ❌ 無 | 完全正常使用 | — |
| **持倉計算** | ❌ 無 | 完全正常使用 | — |
| **流水查詢/篩選** | ❌ 無 | 完全正常使用 | — |
| **模糊搜索股票代碼** | ❌ 無 | 查詢本地 `stock_universe` 表 | — |
| **🔄 同步行情** | ✅ 必須 | 點擊時若離線 → Toast「當前處於離線狀態，行情刷新需要網絡連接」 | 正常請求 |
| **下拉刷新** | ❌ 無 | 完全正常使用（僅本地計算，不拉行情） | — |
| **同步市場數據** | ✅ 必須 | 點擊時若離線 → Toast「當前處於離線狀態，市場數據同步需要網絡連接」 | 正常請求 |
| **股票名稱補全** | ⚠️ 可選 | 提交交易時若 `stock_universe` 和 `stocks` 均無名稱 → 用代碼暫代名稱 | 下次行情刷新時從 Yahoo API `meta.longName` 補全 |
| **除權即時預覽** | ❌ 無 | 基於本地持倉數據計算 | — |

### 8.2 三類操作的實現指引

#### 純本地操作（無需任何網路判斷）

```typescript
// 交易錄入、分紅錄入、刪除、持倉計算、流水查詢
// → 直接調用 portfolioService，不做任何網路狀態檢查
async function submitTrade(tx: TxInput) {
  await addTransaction(tx);   // 純 SQLite 操作
  await refreshPortfolioData();
  uni.navigateBack();
}
```

#### 必須聯網操作（點擊時檢查，離線則拒絕）

```typescript
// 行情刷新、市場數據同步
async function handleRefreshQuotes() {
  // 1. 檢查網路狀態
  const isOnline = await checkNetworkStatus();
  if (!isOnline) {
    uni.showToast({ title: '當前處於離線狀態，行情刷新需要網絡連接', icon: 'none' });
    return;  // 不發起請求，不改變任何狀態
  }

  // 2. stocks 為空的額外保護
  const count = await db.selectSql('SELECT COUNT(*) as c FROM stocks');
  if (count[0].c === 0) {
    uni.showToast({ title: '暫無股票數據，請先錄入交易', icon: 'none' });
    return;
  }

  // 3. 執行刷新
  await batchFetchQuotes();
  await refreshPortfolioData();
}
```

#### 聯網增強操作（嘗試聯網，失敗則降級）

```typescript
// 股票名稱補全：提交交易時
async function ensureStockName(code: string): Promise<string> {
  // 先查本地 stock_universe
  const local = await db.selectSql(
    'SELECT stock_name FROM stock_universe WHERE stock_code = ?', [code]
  );
  if (local.length > 0 && local[0].stock_name) return local[0].stock_name;

  // 再查 stocks 表（之前可能通過行情刷新獲得）
  const cached = await db.selectSql(
    'SELECT stock_name FROM stocks WHERE stock_code = ?', [code]
  );
  if (cached.length > 0 && cached[0].stock_name) return cached[0].stock_name;

  // 都沒有 → 用代碼本身作為名稱（後續行情刷新時自動補全）
  return code;  // 例如 '00700' 作為臨時名稱
}
```

### 8.3 網路狀態檢測

```typescript
/** 檢測當前網路狀態 */
async function checkNetworkStatus(): Promise<boolean> {
  // uni-app 提供的網路狀態 API
  return new Promise((resolve) => {
    uni.getNetworkType({
      success: (res) => resolve(res.networkType !== 'none'),
      fail: () => resolve(false),  // API 調用失敗 → 保守假設離線
    });
  });
}
```

### 8.4 離線 UI 狀態規範

| UI 元素 | 聯網時 | 離線時 |
|------|--------|--------|
| 🔄 同步行情按鈕 | 正常可點擊 | **不隱藏不禁用**，點擊時 Toast 提示（用戶可自行判斷是否嘗試） |
| 同步市場數據按鈕 | 正常可點擊 | 同上 |
| 行情更新時間 | 顯示最新刷新時間 | **保留顯示**上次成功刷新時間（不因離線而清空） |
| 看板盈虧數據 | 基於緩存行情計算 | **基於緩存行情計算**（完全不受影響） |
| 持倉列表現價 | 最新行情 | 緩存行情（數據來自 stocks 表） |
| 下拉刷新 | 正常 | **正常**（純本地操作） |
| 交易/分紅提交按鈕 | 正常 | **正常**（純本地操作） |

**核心原則**：UI 不因離線而變化。只有當用戶主動點擊需要聯網的按鈕時才提示。這確保離線體驗與聯網體驗在視覺上沒有區別。

### 8.5 首次啟動特殊場景

首次啟動（全新安裝）時：
- `stocks` 表為空 → 沒有任何行情緩存
- 看板正常顯示（總資產 = 現金 = 0，所有盈虧 = 0）
- 持倉列表顯示空狀態引導
- 用戶可立即錄入交易（純本地）
- 行情刷新需要聯網（stocks 為空時不發請求 → Toast「暫無股票數據」）
- `stock_universe` 從種子 JSON 導入（~100 隻），模糊搜索基本可用

---


---
## 9. 統一校驗規則註冊表 (Validation Rules Registry)

本節為系統中所有校驗規則的**唯一真相源**。AI 實現時不得在其他文檔中推斷校驗邏輯——所有規則以本節為準。

### 9.1 校驗函數類型定義

```typescript
/** 校驗結果 */
interface ValidationResult {
  valid: boolean;
  field: string;         // 字段名，如 'stock_code'
  message: string;       // 失敗時的用戶提示（中文）
}

/** 校驗規則函數簽名 */
type ValidationRule = (value: string, context?: ValidationContext) => ValidationResult;

/** 校驗上下文（用於需要跨字段或 DB 狀態的規則） */
interface ValidationContext {
  tradeType?: 'BUY' | 'SELL';        // 當前 Tab
  currentHolding?: { quantity: Big; avgPrice: Big };  // 當前持倉（賣出校驗用）
  dividendTotal?: string;            // 分紅總額（扣稅校驗用）
  positionList?: Position[];         // 全局持倉列表
  stockUniverse?: StockInfo[];       // 模糊搜索結果
}
```

### 9.2 校驗規則分層

| 層級 | 執行位置 | 觸發時機 | 反饋方式 | 依賴 |
|------|----------|----------|----------|------|
| **L1 格式校驗** | View 層 (pages) | `@blur`（失焦即檢） | 字段邊框變紅 + 內聯提示 | 無（純客戶端） |
| **L2 業務校驗** | Service 層 | 提交時（`addTransaction` 入口） | throw AppError(VALIDATION) → Toast | SQLite（需查持倉狀態） |
| **L3 跨字段校驗** | View 層 | 提交前（`submit()` 方法中） | 阻止提交 + 內聯提示 | 表單內其他字段值 |

### 9.3 交易頁 (`trade.vue`) 完整規則表

| ID | 層級 | 字段 | 規則 | 觸發 | 錯誤訊息 |
|----|------|------|------|------|----------|
| TV-01 | L1 | stock_code | 非空 | blur | 「請選擇或輸入有效的港股代碼」 |
| TV-02 | L1 | stock_code | 純數字 4-5 位（格式化後為 5 位） | blur | 「請輸入 4-5 位數字代碼」 |
| TV-03 | L1 | quantity | 非空 | blur | 「請輸入交易數量」 |
| TV-04 | L1 | quantity | 正數（> 0，含碎股小數） | blur | 「請輸入有效的交易數量」 |
| TV-05 | L1 | price | 非空 | blur | 「請輸入交易單價」 |
| TV-06 | L1 | price | 正數（> 0） | blur | 「請輸入有效的交易單價」 |
| TV-07 | L1 | fee | ≥ 0（可空，空視為 0） | blur | 「手續費不能為負數」 |
| TV-08 | L1 | trade_date | 非空 | blur | 「請選擇交易日期」 |
| TV-09 | L1 | trade_date | ≤ 今天 | blur | 「交易日期不能晚於今天」 |
| TV-10 | L1 | remark | ≤ 200 字符 | blur | 「備註不能超過 200 字」 |
| TV-11 | L2 | quantity | SELL 時 ≤ 當前持倉數量 | submit | 「賣出數量超過當前持倉（{n} 股）」 |
| TV-12 | L2 | stock_code | SELL 時目標股票必須有持倉（quantity > 0） | submit | 「當前沒有該股票的持倉，無法賣出」 |
| TV-13 | L3 | quantity | SELL 時若 quantity == 持倉數量 → 清倉二次確認 | submit | 彈窗確認（不是阻擋，是確認後放行） |

### 9.4 分紅頁 (`dividend.vue`) 完整規則表

| ID | 層級 | 字段 | 規則 | 觸發 | 錯誤訊息 |
|----|------|------|------|------|----------|
| DV-01 | L1 | stock_code | 非空 | blur | 「請選擇或輸入有效的港股代碼」 |
| DV-02 | L1 | stock_code | 純數字 4-5 位 | blur | 「請輸入 4-5 位數字代碼」 |
| DV-03 | L1 | price | 非空 | blur | 「請輸入分紅總額」 |
| DV-04 | L1 | price | 正數（> 0） | blur | 「請輸入有效的分紅總額」 |
| DV-05 | L1 | fee | ≥ 0（可空，空視為 0） | blur | 「扣稅金額不能為負數」 |
| DV-06 | L3 | fee | < price（扣稅金額必須小於分紅總額） | submit | 「扣稅金額不能超過分紅總額」 |
| DV-07 | L1 | trade_date | 非空 | blur | 「請選擇除權日期」 |
| DV-08 | L1 | trade_date | ≤ 今天 | blur | 「除權日期不能晚於今天」 |
| DV-09 | L1 | remark | ≤ 200 字符 | blur | 「備註不能超過 200 字」 |
| DV-10 | L2 | fee | 分紅淨額（price - fee）的計算需在提交時用 big.js 驗證無溢出 | submit | 「分紅金額計算異常，請檢查輸入」 |

### 9.5 通用規則（交易頁和分紅頁共用）

| ID | 層級 | 字段 | 規則 | 觸發 | 錯誤訊息 |
|----|------|------|------|------|----------|
| CM-01 | L1 | stock_code | 若手動輸入（非從下拉選中）→ 格式化後檢查是否為有效港股代碼格式 | blur | 「請輸入有效的港股代碼」 |
| CM-02 | — | 全部必填字段 | 提交時遍歷所有 L1 規則；任一失敗 → 阻止提交，聚焦到第一個失敗字段 | submit | — |
| CM-03 | — | isLoading | 提交進行中時禁止再次提交（按鈕 disabled + isLoading 鎖） | submit | — |

### 9.6 View 層校驗實現模板

```typescript
// pages/trade/trade.vue — 表單校驗邏輯

/** L1 規則（純客戶端，blur 時執行） */
const stockCodeRules: ValidationRule[] = [
  { field: 'stock_code', test: (v) => !!v.trim(), message: '請選擇或輸入有效的港股代碼' },
  { field: 'stock_code', test: (v) => /^\d{4,5}$/.test(v.replace(/\D/g, '')), message: '請輸入 4-5 位數字代碼' },
];

/** 單字段校驗（@blur 觸發） */
function validateField(field: string, value: string): string | null {
  const rules = getRulesForField(field);  // 從註冊表獲取
  for (const rule of rules) {
    const result = rule(value);
    if (!result.valid) return result.message;
  }
  return null;  // 通過
}

/** 全表單校驗（submit 前觸發） */
function validateForm(form: TradeForm, context: ValidationContext): ValidationResult[] {
  const errors: ValidationResult[] = [];

  // L1: 所有字段格式校驗
  for (const [field, value] of Object.entries(form)) {
    const msg = validateField(field, String(value));
    if (msg) errors.push({ valid: false, field, message: msg });
  }

  // L3: 跨字段校驗
  if (context.tradeType === 'SELL') {
    const sellQty = new Big(form.quantity);
    const holding = context.currentHolding?.quantity || new Big(0);
    if (sellQty.gt(holding)) {
      errors.push({ valid: false, field: 'quantity', message: `賣出數量超過當前持倉（${holding} 股）` });
    }
  }

  return errors;  // [] 表示全部通過
}
```

### 9.7 校驗優先級與短路規則

1. **提交時**：先跑 L1（全部字段）→ 任一失敗則阻止提交 + 聚焦第一個錯誤字段
2. **L1 全部通過** → 跑 L3（跨字段）→ 任一失敗則阻止提交
3. **L1+L3 全部通過** → 調用 Service 層 → Service 層跑 L2（業務規則）
4. **L2 失敗** → Service throw AppError(VALIDATION) → Hook 層 catch → Toast

**關鍵**：L1 校驗在 blur 時非阻塞執行（即時反饋），提交時再次執行（防止用戶繞過 blur 直接提交）。

---


---
## 11. 代碼組織與命名規範 (Code Conventions)

本節為 AI 生成的**所有代碼**的強制命名與組織標準。代碼審查時以本節為一致性基準。

### 11.1 完整目錄結構

```
uniapp4/
├── manifest.json                # uni-app 配置
├── pages.json                   # 頁面路由 + TabBar
├── package.json
├── tsconfig.json
├── vite.config.ts               # H5 開發服務器 + 中間件
├── index.html                   # Vite 入口
│
├── src/
│   ├── main.ts                  # Vue 入口，掛載 App
│   ├── App.vue                  # 全局生命週期 (onLaunch → initDatabase)
│   ├── uni.scss                 # 全局 SCSS 變量 + 工具類
│   ├── manifest.json            # → 軟鏈 ../manifest.json
│   ├── pages.json               # → 軟鏈 ../pages.json
│   │
│   ├── pages/
│   │   ├── index/
│   │   │   └── index.vue        # T5: 資產持倉大盤頁
│   │   ├── history/
│   │   │   └── history.vue      # T6: 全量流水賬本頁
│   │   ├── trade/
│   │   │   └── trade.vue        # T7: 股票買賣錄入頁
│   │   └── dividend/
│   │       └── dividend.vue     # T8: 分紅錄入頁
│   │
│   ├── components/
│   │   └── tx-popup/
│   │       └── tx-popup.vue     # T9: 個股歷史流水彈窗
│   │
│   ├── hooks/
│   │   └── usePortfolio.ts      # T4: 全局狀態層
│   │
│   ├── services/
│   │   └── portfolioService.ts  # T3: 業務邏輯層
│   │
│   ├── config/
│   │   └── log.config.ts         # 日誌等級配置
│   │
│   ├── utils/
│   │   ├── db.ts                 # T2: 數據持久層
│   │   └── logger.ts             # 日誌模塊
│   │
│   ├── data/
│   │   └── stock_universe.json   # T2b: 全市場股票主數據
│   │
│   └── static/                  # 靜態資源
│       ├── tab-portfolio.png
│       ├── tab-portfolio-active.png
│       ├── tab-history.png
│       └── tab-history-active.png
│
├── scripts/
│   ├── init-db.mjs              # T2c: 數據庫種子生成
│   ├── download-hkex.mjs         # T2d: 港股列表掃碼
│   ├── logger.mjs               # 日誌模塊
│   └── log-config.mjs           # 日誌等級配置
│
├── public/
│   └── hk_portfolio_db.db       # Vite 靜態服務的種子 DB
│
├── hk_portfolio_db.db           # 本地開發用 SQLite 文件
│
├── test/
│   ├── unit/                    # 單元測試
│   ├── integration/             # 集成測試
│   ├── e2e/                     # E2E 測試（手動）
│   ├── fixtures/                # 測試工廠
│   └── migrations/              # 遷移測試
│
├── logs/                        # 服務端日誌
│   └── server-YYYY-MM-DD.log
│
└── docs/                        # 本文件集
```

### 11.2 文件命名

| 類型 | 風格 | 示例 |
|------|------|------|
| Vue 頁面文件 | `kebab-case.vue` | `index.vue`, `history.vue`, `trade.vue` |
| Vue 組件文件 | `kebab-case.vue` | `tx-popup.vue` |
| TypeScript 模塊 | `camelCase.ts` | `portfolioService.ts`, `usePortfolio.ts`, `db.ts` |
| Node.js 腳本 | `kebab-case.mjs` | `init-db.mjs`, `download-hkex.mjs` |
| JSON 數據文件 | `snake_case.json` | `stock_universe.json` |
| 測試文件 | `*.test.ts` | `portfolioService.test.ts` |
| 靜態資源 | `kebab-case.png` | `tab-portfolio.png` |

### 11.3 TypeScript 命名

| 元素 | 風格 | 示例 |
|------|------|------|
| 接口/類型 | PascalCase | `TransactionRow`, `TxInput`, `Position` |
| 枚舉 | PascalCase + 值 UPPER_SNAKE | `ErrorType.VALIDATION` |
| 函數 | camelCase | `formatStockCode()`, `calculatePositions()` |
| 變量 | camelCase | `positionList`, `totalAsset` |
| 常量 | UPPER_SNAKE_CASE | `TARGET_SCHEMA_VERSION` |
| Ref 變量 | camelCase（不加 `Ref` 後綴） | `totalAsset`, `isLoading` |
| 私有函數 | camelCase（不加 `_` 前綴） | `validateField()`（通過不 export 實現私有） |
| 事件處理器 | `handle` + 動作 | `handleSubmit()`, `handleRefresh()` |
| DB 行類型 | `*Row` 後綴 | `StockRow`, `TransactionRow` |
| 輸入類型 | `*Input` 後綴 | `TxInput` |

### 11.4 Vue 組件規範

```vue
<!-- 模板：kebab-case 標籤 -->
<template>
  <view class="page-container">
    <tx-popup :visible="showPopup" @close="handleClose" />
  </view>
</template>

<script setup lang="ts">
// 1. imports（第三方先，本地後）
import { ref, onShow } from 'vue';
import { usePortfolio } from '@/hooks/usePortfolio';

// 2. props & emits
const props = defineProps<{ ... }>();
const emit = defineEmits<{ ... }>();

// 3. composables
const { positionList, refreshPortfolioData } = usePortfolio();

// 4. local state
const showPopup = ref(false);

// 5. computed

// 6. methods
function handleClose() { ... }

// 7. lifecycle
onShow(() => { ... });
</script>

<style scoped lang="scss">
/* 組件級樣式，使用 scoped */
</style>
```

### 11.5 CSS 類名規範

採用**語義化 kebab-case**（非 BEM 全稱，因 uni-app 組件層級較淺）：

```scss
// ✅ 正確
.asset-card { }
.position-item { }
.stock-code { }
.text-red { }
.badge-buy { }
.courier-bold-code { }

// ❌ 錯誤
.assetCard { }       // 非 kebab-case
.AssetCard { }       // 非 PascalCase
.asset_card { }      // 非 snake_case
.asset__card--big { } // BEM 過度（本項目不需要）
```

**全局工具類**（定義於 `src/uni.scss`，與 ui-design.md 一致）：
```scss
.text-red    { color: #fa4d56 !important; }
.text-green  { color: #24a148 !important; }
.text-gold   { color: #f1c40f !important; }
```

### 11.6 Import 順序

每個文件的 import 按以下順序分組（組間空一行）：

```typescript
// 1. Vue 核心
import { ref, computed, onShow } from 'vue';

// 2. 第三方庫
import Big from 'big.js';

// 3. 本地 hooks
import { usePortfolio } from '@/hooks/usePortfolio';

// 4. 本地 services
import { addTransaction } from '@/services/portfolioService';

// 5. 本地 utils
import { formatStockCode } from '@/utils/db';

// 6. 類型（使用 import type 以確保編譯時擦除）
import type { TxInput, Position } from '@/types';
```

### 11.7 路徑別名

`vite.config.ts` 和 `tsconfig.json` 中配置以下別名：

| 別名 | 路徑 | 用途 |
|------|------|------|
| `@/` | `src/` | 源代碼根目錄 |
| `@/components/` | `src/components/` | 組件 |
| `@/hooks/` | `src/hooks/` | 狀態 hooks |
| `@/services/` | `src/services/` | 業務服務 |
| `@/utils/` | `src/utils/` | 工具函數 |
| `@/data/` | `src/data/` | 靜態數據文件 |

禁止使用相對路徑跨越兩個以上目錄層級（`../../../`）。一律使用 `@/` 別名。

### 11.8 禁止事項

| 禁止 | 原因 |
|------|------|
| `any` 類型（除非處理未知的外部 API 響應） | 破壞類型安全 |
| `var` 聲明 | 使用 `const` / `let` |
| `==` 比較（使用 `===`） | 隱式類型轉換 |
| `console.log` 在生產代碼中（使用 logger 模塊） | 統一日誌管理 |
| 字符串拼接 SQL | SQL 注入防禦（conventions.md §1.1） |
| 原生 `number` 做金額運算 | IEEE 754 精度損失（conventions.md §2.1） |
| 相對路徑 `../../../` | 使用 `@/` 別名 |
| 在 `.vue` 文件中寫全局樣式（必須 `scoped`） | 避免樣式汙染 |
| 在 `watch`/`computed` 中執行副作用（使用 `watchEffect` 或顯式函數） | 數據流可預測性 |

---


---
## 13. 安全策略 (Security Policy)

### 13.1 威脅模型

| 威脅 | 風險等級 | 影響 |
|------|:--:|------|
| SQL 注入（用戶輸入被拼接到 SQL） | 🔴 高 | 數據洩露、數據損壞 |
| XSS（remark 字段注入腳本） | 🟡 中 | 頁面異常、釣魚 |
| 敏感數據日誌洩露 | 🟡 中 | 隱私洩露（交易金額、持倉） |
| 錯誤堆棧暴露內部邏輯 | 🟢 低 | 攻擊信息收集 |
| DB 文件被導出分析 | 🟢 低 | 需物理訪問 + 越獄/Root |
| Yahoo API 中間人攻擊 | 🟢 低 | 行情數據被篡改（HTTPS 默認防護） |

### 13.2 輸入消毒 (Input Sanitization)

所有用戶輸入在寫入 DB **前**和渲染到 UI **前**都必須消毒。

```typescript
/** 消毒用戶文本輸入（remark、stock_code 等） */
function sanitizeInput(input: string, maxLength: number = 200): string {
  return input
    .trim()                           // 去首尾空白
    .replace(/[<>]/g, '')            // 移除 HTML 標籤字符
    .replace(/[\x00-\x1F]/g, '')     // 移除控制字符
    .slice(0, maxLength);            // 截斷超長
}

/** 消毒股票代碼輸入（僅保留數字） */
function sanitizeStockCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 5);
}
```

**觸發時機**：
- `remark` 字段：提交前消毒（View 層）+ 入庫前消毒（Service 層，雙重保護）
- `stock_code`：輸入時實時過濾非數字字符（View 層 `@input` 事件）
- `price`、`quantity`、`fee`：僅接受數字和小數點（`input type="digit"` + regex 校驗）

### 13.3 輸出編碼 (Output Encoding)

用戶輸入的 remark 在渲染到 UI 時必須進行 HTML 轉義：

```vue
<!-- Vue 模板中默認轉義（使用 {{ }} 而非 v-html）→ 安全 ✅ -->
<text>{{ tx.remark }}</text>

<!-- 禁止：v-html 會執行 HTML → 危險 ❌ -->
<text v-html="tx.remark"></text>
```

**規則**：整個項目**禁止使用 `v-html`**。所有用戶內容通過文本插值 (`{{ }}`) 渲染，Vue 自動執行 HTML 轉義。

### 13.4 敏感數據保護

| 數據類型 | 保護措施 |
|------|------|
| 交易金額（price, fee, cash_impact） | 禁止寫入日誌（§7.5）；禁止在 `console.log` 輸出 |
| 持倉總市值 | 不在 `uni.setStorage` 中緩存（避免其他 App 讀取） |
| 股票代碼 + 數量組合 | 日誌中可記錄代碼，**不可**同時記錄數量（防止推算出持倉規模） |
| 現金餘額 | 禁止在任何日誌、錯誤訊息、UI 調試面板中顯示 |
| Yahoo API 請求 URL | 允許記錄（僅含股票代碼，無隱私信息） |

### 13.5 錯誤信息屏蔽

向用戶展示的錯誤信息**不得**包含內部實現細節：

```typescript
// ❌ 錯誤：暴露內部 SQL 和路徑
uni.showToast({ title: `SQLite error: no such table: stocks at _doc/hk_portfolio_db.db` });

// ✅ 正確：通用錯誤訊息 + 內部日誌記錄完整信息
logger.error('[DB] SELECT stocks failed', { error: e, sql: 'SELECT * FROM stocks' });
uni.showToast({ title: '數據加載失敗，請重試', icon: 'none' });
```

**AppError.userMessage 必須滿足**：
- 不含文件路徑、SQL 語句、堆棧追蹤
- 不含數據庫表名、欄位名
- 不含第三方庫名稱和版本
- 使用中文，面向最終用戶而非開發者

### 13.6 數據庫文件安全

**V1 策略（基於 OS 沙盒防護）**：

| 平台 | 防護機制 | 風險 |
|------|----------|------|
| iOS | App Sandbox + Data Protection | 越獄設備可導出 .db 文件 |
| Android | App Sandbox + Scoped Storage | Root 設備可導出 .db 文件 |

- **V1 不實施應用層加密**（SQLCipher 等）。數據安全依賴操作系統級沙盒。
- `.db` 文件存儲在 `_doc/` 目錄（非備份到 iCloud/Google Drive 的目錄），但用戶可通過系統級備份（iCloud Backup / Google Backup）間接備份數據庫文件。
- **V2 可考慮**：用戶設置密碼 → 使用 SQLCipher 加密數據庫文件。這需要額外的依賴和密鑰管理。

### 13.7 網路傳輸安全

| 請求 | 協議 | 風險 |
|------|------|------|
| Yahoo Finance API | HTTPS（Vite 代理 / uni.request） | 證書驗證由系統處理 |
| 本項目無自有後端 | — | 無需考慮自簽證書、JWT、CSRF 等 |

`uni.request` 默認啟用 HTTPS 證書驗證，無需額外配置。

### 13.8 安全檢查清單（Code Review 時核查）

- [ ] 所有 SQL 使用參數化查詢（無字符串拼接）
- [ ] 所有用戶輸入經過 `sanitizeInput()` 消毒
- [ ] 無 `v-html` 指令
- [ ] 錯誤訊息不含內部路徑/SQL/堆棧
- [ ] 日誌不含交易金額、現金餘額、持倉數量
- [ ] `remark` 等自由文本字段有長度限制（≤200）
- [ ] 價格/數量輸入框使用 `type="digit"` 限制鍵盤類型
- [ ] 第三方依賴無已知高危漏洞（`npm audit`）

---


---
## 14. 文檔治理 (Documentation Governance)

### 14.1 文檔角色與層級

```
                    ┌──────────────┐
                    │  tasks.md    │  ← 🏛️ 執行主線（最高裁決權）
                    │  (執行聖經)   │
                    └──────┬───────┘
                           │ 引用/覆蓋
   ┌───────────────────────┼───────────────────────────┐
   ▼                       ▼                           ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ types.md     │  │ architecture.md  │  │ conventions.md   │
│ (類型定義)   │  │ (架構+DB+API)    │  │ (錯誤+安全+規範)  │
└──────────────┘  └──────────────────┘  └──────────────────┘
   │                       │                      │
   ▼                       ▼                      ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ ui-design.md │  │ requirements.md  │  │ tests/test-plan  │
│ (視覺規範)   │  │ (需求原始意圖)    │  │ (驗證清單)       │
└──────────────┘  └──────────────────┘  └──────────────────┘
```

### 14.2 文檔職責邊界

| 文檔 | 角色 | 讀者 | 更新頻率 | 合併自 |
|------|------|------|----------|--------|
| **tasks.md** | 🏛️ 執行主線 | AI 編碼時逐條執行 | 每次需求變更 | task.md |
| **types.md** | 類型定義 | 所有模塊的接口參照 | 接口變更時 | spec.md §6 |
| **architecture.md** | 架構+DB+API | AI 理解系統設計 | 架構決策變更時 | spec.md §1-§5,§12 + db.md |
| **conventions.md** | 編碼規則 | Code Review 參照 | 規則變更時 | spec.md §7-§11,§13-§14 + conventions.md |
| **ui-design.md** | 視覺規範 | UI 實現時逐元素參照 | UI 變更時 | design.md + css.md |
| **requirements.md** | 需求原始意圖 | 背景理解 | 僅重大需求變更 | — |
| **tests/test-plan.md** | 測試劇本 | 寫完代碼後逐條驗證 | 功能變更時 | — |

### 14.3 衝突裁決鏈

```
1. tasks.md            ← 最高裁決權（唯一執行依據）
2. types.md            ← 類型定義（字段名、類型、可選性）
3. architecture.md     ← 架構決策（分層、DB schema、API、生命週期）
4. conventions.md      ← 編碼規則（錯誤處理、安全、命名、離線策略）
5. ui-design.md        ← 視覺規範（僅 UI 相關衝突時）
6. requirements.md     ← 原始需求（僅 tasks.md 有遺漏時回查）
7. test-plan.md        ← 不參與裁決（它是驗證標準，不是實現標準）
```

**裁決原則**：
- tasks.md 說 A，其他文檔說 B → **A 贏**。
- 若兩個同級文檔衝突 → 以**最近更新日期**為準。

### 14.4 更新觸發規則

| 變更類型 | 必須更新的文檔 |
|------|------|
| 新增/修改 API 端點 | tasks.md, architecture.md |
| 新增/修改數據庫表或欄位 | tasks.md, architecture.md, types.md |
| 新增/修改 TypeScript 接口 | types.md |
| 修改 UI 佈局/顏色/字號 | ui-design.md |
| 新增/修改校驗規則 | conventions.md（§9）, tasks.md |
| 修改錯誤處理行為 | conventions.md（§7） |
| 修改離線行為 | conventions.md（§8） |
| 新增/修改安全策略 | conventions.md（§13） |
| 修改遷移策略 | architecture.md（§5）, tasks.md |
| 新增/修改命名或代碼風格 | conventions.md（§11） |
| 新增/修改功能需求 | requirements.md, tasks.md |
| 修改生命週期/數據流 | architecture.md（§6） |
| 新增/修改測試用例 | tests/test-plan.md |

### 14.5 AI 文檔同步檢查清單

- [ ] 變更是否影響 tasks.md 中的約束/驗證？→ 更新 tasks.md
- [ ] 變更是否影響類型定義？→ 更新 types.md
- [ ] 變更是否影響 UI 視覺？→ 更新 ui-design.md
- [ ] 變更是否引入新的錯誤處理分支？→ 更新 conventions.md
- [ ] 變更是否修改了 DB schema？→ 更新 architecture.md
- [ ] 變更是否影響測試用例？→ 更新 test-plan.md
| **禁止** | 在 `Position`、`TxInput` 的數字字段上使用 `number \| string` 聯合類型 |
---
# 港股本地持倉管理系統 - AI 開發技能與最佳實踐約束 (Skills & Best Practices)

本文件定義了 AI (Claude Code / DeepSeek) 在編碼時必須具備的頂尖工程技能、防禦性編程規範與性能優化目標，作為代碼質量的最嚴格審查標準。

---

## 1. 數據持久層：安全與事務技能 (SQLite Database Skills)

1. **SQL 注入絕對防禦 (Anti-SQL Injection)**：
   - 系統涉及大量的股票代碼與用戶備註輸入。AI 在編寫任何 SQLite 執行陳述式（`executeSql`, `selectSql`）時，**嚴禁使用字符串直接拼接 (String Interpolation) 構造 SQL**。
   - 必須全面採用**參數化查詢 (Parameterized Queries / Prepared Statements)**，將用戶輸入作為綁定參數傳入。

2. **複式記賬事務原子性 (Database Transaction Mastery)**：
   - 「流水寫入」與「可用現金餘額更新」是絕對一體的。
   - AI 在實作 `addTransaction` 與 `deleteTransaction` 時，必須將「寫入/刪除流水」與「更新 `cash_account`」這兩個步驟**包裹在同一個數據庫事務 (Transaction: BEGIN / COMMIT / ROLLBACK) 中**。
   - 只要任何一步失敗，必須全自動執行回滾，從源頭徹底杜絕「有交易紀錄但現金沒變動」或「現金變了但找不到歷史流水」的髒數據 Bug。

3. **數據類型精度閉環 (TEXT for Monetary Values)**：
   - 所有涉及金額與數量的 SQLite 欄位（`price`, `fee`, `cash_impact`, `available_cash`, `current_price`, `yesterday_close`, `quantity`）必須使用 `TEXT` 類型存儲。
   - 讀寫時由應用層使用 `big.js` 進行序列化（寫入前 `Big.toString()`）與反序列化（讀取後 `new Big(textValue)`）。
   - **SQLite REAL = IEEE 754 雙精度浮點數，與 big.js 的任意精度十進制運算不相容。** TEXT 是唯一能保證「寫入什麼、讀出什麼」的存儲方式。

---

## 2. 業務邏輯層：高精度金融計算與防御性編程

1. **零原生浮點數依賴 (Zero Native Float Dependency)**：
   - 由於港股涉及大額資金與多位小數的持倉均價，JavaScript 原生浮點數（`0.1 + 0.2 !== 0.3`）會造成嚴重的利潤對不齊。
   - AI 必須具備高度的計算敏感度。在業務邏輯層中，**凡是涉及金錢、手續費、均價、市值、累計與今日盈虧的任何運算（加、減、乘、除、絕對值、比較大小），必須全程使用 `big.js` 庫的方法**。
   - 數據在入庫前或展示在 UI 最終結尾時，方可轉回數字或字串格式，中間計算過程必須完全被高精度庫鎖死。

2. **時間線數據防禦 (Chronological Integrity)**：
   - 在重算持倉成本時，流水賬本的順序就是生命。
   - AI 必須具備時間線審計思維。從資料庫提取流水後，在進入計算循環前，必須在內存中執行一道**強制排序防禦**（以 `trade_date` 升序為第一關鍵字，`created_at` 系統時間戳升序為第二關鍵字），防止因用戶補錄歷史數據導致的時間線錯亂、均價重算錯誤。

---

## 3. 前端數據流：異步全生命週期控制 (Async & State Management)

1. **異步阻塞式冷啟動 (Blocking In-Memory Initialization)**：
   - 在單機應用中，表不存在或數據未加載就渲染 UI 是報錯的重災區。
   - AI 必須實現強控制流：應用的全局生命週期 `onLaunch` 必須是一個可等待的 Promise，在底層創表、字典數據初始化（如現金賬戶為 0 的紀錄）未完全成功（Resolved）之前，**必須阻塞（Block）上層 Hook 的數據讀取與頁面初次渲染**，確保視圖層加載時永遠能拿到就緒的本地數據環境。

2. **狀態單一可信源 (Single Source of Truth)**：
   - 系統嚴禁在各個頁面各自去查數據庫或各自維護局部狀態。
   - 全局資產看板、今日盈虧、持倉列表必須一律綁定至狀態 Hook（`usePortfolio`）所導出的全局單例 Ref 上。
   - 任何錄入或刪除操作，成功後的唯一目標是調用 Hook 的 `refresh` 函數，由數據庫倒灌通知全應用 UI 自動刷新，實現數據流的單向循環（Unidirectional Data Flow）。

3. **並發操作防禦 (Concurrency Guard)**：
   - 所有觸發數據變更或網路請求的操作（行情刷新、交易提交、分紅錄入、交易刪除）必須設置 `isLoading` 布爾鎖。
   - 在 `isLoading === true` 期間：(a) 對應按鈕視覺禁用（灰色 + 降低透明度），(b) 禁止重複提交/重複請求，(c) 操作完成（成功或失敗）後必須釋放鎖。
   - 嚴禁用戶快速連點導致重複入庫或重複網路請求。
   
   **行情刷新並發策略（v8 API 逐隻請求）**：
   - Yahoo v8 `chart` API 不支援批量查詢，必須逐隻請求。為避免被限流封 IP：
     - 請求間隔 ≥ 200ms（以延遲隊列控制節奏）
     - 最大並發數 ≤ 3
     - 單隻失敗不影響其他請求繼續
   - 此為 v7→v8 遷移的必要調整（v7 批量端點已於 2026 年下線，返回 401）

4. **性能預期 (Performance Baseline)**：
   - 系統設計目標：在本地累積 **5000 條**交易流水以內，所有頁面（首頁大盤、全量流水、個股彈窗）的首次加載與數據刷新必須在 **1 秒內**完成。
   - `calculatePositions()` 的全量重算 O(n) 在此規模下可接受。若未來流水超 10,000 條，可考慮引入持倉快照（snapshot）+ 增量計算策略。

5. **平台鎖定 (Platform Lock-in)**：
   - 第一版**僅支援 5+ App Native 平台**（iOS / Android），使用 `plus.sqlite` 進行本地持久化。
   - H5 環境使用 sql.js（SQLite WASM）作為桌面驗證環境，支援完整系統功能。
   - 微信小程序等平台因底層數據庫 API（`wx.cloud.database`）與 `plus.sqlite` 完全不相容，不在首版範圍內。