/**
 * 數據持久層 — SQLite 數據庫管理
 *
 * 三環境自適應：
 *   App Native → plus.sqlite
 *   H5 瀏覽器 → sql.js (WASM) + IndexedDB
 *   Node.js    → sql.js (WASM) 內存
 */
import { createLogger } from './logger';
// Vite: import WASM URL so bundler handles it correctly
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

const logger = createLogger('db');

// ===== Types =====
type SQLiteInstance = any; // sql.js Database | plus.sqlite

let dbInstance: SQLiteInstance | null = null;
let dbIsAppPlatform = false;
let initSqlJs: any = null;

// ===== 環境判斷 =====
export function getIsAppPlatform(): boolean {
  return typeof (globalThis as any).plus !== 'undefined'
    && (globalThis as any).plus?.sqlite !== undefined;
}

// ===== IndexedDB helpers (H5 only) =====
const IDB_NAME = 'hk_portfolio_db';
const IDB_STORE = 'state';
const IDB_KEY = 'db';

async function loadFromIndexedDB(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => {
        try {
          const tx = req.result.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get(IDB_KEY);
          getReq.onsuccess = () => resolve(getReq.result?.buffer ?? null);
          getReq.onerror = () => resolve(null);
        } catch { resolve(null); }
      };
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function saveToIndexedDB(buffer: ArrayBuffer): void {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put({ id: IDB_KEY, buffer }, IDB_KEY);
      } catch { /* silent */ }
    };
  } catch { /* silent */ }
}

function autoSave(): void {
  if (dbIsAppPlatform || !dbInstance) return;
  try {
    const data = dbInstance.export(); // sql.js: Uint8Array of the entire DB
    const buffer = data.buffer.slice(0) as ArrayBuffer;
    saveToIndexedDB(buffer);
    fetch('/api/save-db', { method: 'POST', body: buffer }).catch(() => {});
  } catch { /* silent */ }
}

// ===== 初始化 =====
const TARGET_SCHEMA_VERSION = 1;

const DDL_STATEMENTS = [
  // 1. stocks
  `CREATE TABLE IF NOT EXISTS stocks (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    current_price TEXT DEFAULT '0.00',
    yesterday_close TEXT DEFAULT '0.00',
    updated_at TEXT
  )`,
  // 2. transactions
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stock_code TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('BUY','SELL','DIVIDEND')),
    trade_date TEXT NOT NULL,
    price TEXT DEFAULT '0',
    quantity TEXT DEFAULT '0',
    fee TEXT DEFAULT '0',
    cash_impact TEXT NOT NULL DEFAULT '0',
    remark TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(stock_code) REFERENCES stocks(stock_code) ON DELETE RESTRICT
  )`,
  // 3. cash_account
  `CREATE TABLE IF NOT EXISTS cash_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    available_cash TEXT DEFAULT '0.00',
    updated_at TEXT
  )`,
  // 4. stock_universe
  `CREATE TABLE IF NOT EXISTS stock_universe (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL
  )`,
  // 5. schema_version
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_tx_stock_code ON transactions(stock_code)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_date_created ON transactions(trade_date ASC, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_universe_code ON stock_universe(stock_code)`,
];

export async function initDatabase(): Promise<void> {
  dbIsAppPlatform = getIsAppPlatform();

  if (dbIsAppPlatform) {
    await initAppDatabase();
  } else {
    await initBrowserDatabase();
  }

  // 執行冪等 DDL
  for (const sql of DDL_STATEMENTS) {
    await executeSql(sql, []);
  }
  for (const sql of INDEX_STATEMENTS) {
    await executeSql(sql, []);
  }

  // 檢查並執行遷移
  await runMigrations();

  // 初始化現金賬戶
  const cashCount = await selectSql('SELECT COUNT(*) as c FROM cash_account', []);
  if ((cashCount as any)[0]?.c === 0) {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await executeSql(
      "INSERT INTO cash_account (id, available_cash, updated_at) VALUES (1, '0.00', ?)",
      [now]
    );
  }

  // 初始化 stock_universe（從 JSON 導入，若為空）
  await initStockUniverse();

  logger.info('Database initialized');
}

async function initAppDatabase(): Promise<void> {
  const plus = (globalThis as any).plus;
  return new Promise((resolve, reject) => {
    plus.sqlite.openDatabase({
      name: 'hk_portfolio_db',
      path: '_doc/hk_portfolio_db.db',
      success: (db: any) => {
        dbInstance = db;
        logger.info('plus.sqlite opened');
        resolve();
      },
      fail: (e: any) => reject(new Error(`plus.sqlite open failed: ${JSON.stringify(e)}`)),
    });
  });
}

async function initBrowserDatabase(): Promise<void> {
  try {
    // 動態導入 sql.js
    const sqlModule = await import('sql.js');
    initSqlJs = sqlModule.default;
    const SQL = await initSqlJs({
      locateFile: () => wasmUrl,  // Vite resolves this to the correct URL
    });

    // 嘗試從 IndexedDB 恢復
    const saved = await loadFromIndexedDB();
    if (saved) {
      dbInstance = new SQL.Database(new Uint8Array(saved));
      logger.info('sql.js loaded from IndexedDB');
      return;
    }

    // 嘗試 fetch 種子文件
    try {
      const resp = await fetch('/hk_portfolio_db.db');
      if (resp.ok) {
        const buf = await resp.arrayBuffer();
        dbInstance = new SQL.Database(new Uint8Array(buf));
        logger.info('sql.js loaded from seed file');
        return;
      }
    } catch { /* 種子文件不存在 */ }

    // 創建空白數據庫
    dbInstance = new SQL.Database();
    logger.info('sql.js created blank database');
  } catch (e) {
    throw new Error(`sql.js init failed: ${String(e)}`);
  }
}

async function initStockUniverse(): Promise<void> {
  try {
    const count = await selectSql('SELECT COUNT(*) as c FROM stock_universe', []);
    if ((count as any)[0]?.c > 0) return; // 已有數據

    // 嘗試從 JSON 導入
    const resp = await fetch('/src/data/stock_universe.json');
    if (!resp.ok) {
      logger.warn('stock_universe.json not found, fuzzy search unavailable');
      return;
    }
    const stocks: { stock_code: string; stock_name: string }[] = await resp.json();
    if (!stocks.length) return;

    await runInTransaction(async (exec) => {
      const BATCH = 500;
      for (let i = 0; i < stocks.length; i += BATCH) {
        const batch = stocks.slice(i, i + BATCH);
        for (const s of batch) {
          await exec(
            'INSERT OR IGNORE INTO stock_universe (stock_code, stock_name) VALUES (?, ?)',
            [s.stock_code, s.stock_name]
          );
        }
      }
    });
    logger.info(`stock_universe initialized with ${stocks.length} stocks`);
  } catch (e) {
    logger.warn('stock_universe init failed, fuzzy search may be limited', { error: String(e) });
  }
}

// ===== 遷移 =====
async function runMigrations(): Promise<void> {
  const rows = await selectSql('SELECT MAX(version) as v FROM schema_version', []) as any[];
  const currentVersion = rows[0]?.v ?? 0;

  if (currentVersion >= TARGET_SCHEMA_VERSION) return;

  for (let v = currentVersion + 1; v <= TARGET_SCHEMA_VERSION; v++) {
    const migrator = MIGRATIONS[v];
    if (migrator) {
      await runInTransaction(async () => {
        await migrator();
        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        await executeSql('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [v, now]);
      });
    }
  }
}

const MIGRATIONS: Record<number, () => Promise<void>> = {
  // 1: migrateV1ToV2,  // 未來使用
};

// ===== SQL 執行 =====
export async function executeSql(sql: string, params: any[] = []): Promise<any> {
  if (!dbInstance) throw new Error('[DB] Database not initialized');

  if (dbIsAppPlatform) {
    return new Promise((resolve, reject) => {
      (dbInstance as any).executeSql(sql, params,
        (_tx: any, rs: any) => resolve(rs),
        (_tx: any, err: any) => reject(new Error(`SQL error: ${JSON.stringify(err)}`))
      );
    });
  }

  // sql.js
  try {
    dbInstance.run(sql, params);
    debouncedAutoSave();
  } catch (e) {
    logger.error('executeSql failed', { sql: sql.slice(0, 80), error: String(e) });
    throw e;
  }
}

let autoSaveTimer: any = null;
function debouncedAutoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { autoSave(); autoSaveTimer = null; }, 500);
}

export async function selectSql(sql: string, params: any[] = []): Promise<any[]> {
  if (!dbInstance) throw new Error('[DB] Database not initialized');

  if (dbIsAppPlatform) {
    return new Promise((resolve, reject) => {
      (dbInstance as any).selectSql(sql, params,
        (_tx: any, rs: any) => {
          // plus.sqlite returns rows differently; normalize
          const rows: any[] = [];
          if (rs && rs.rows) {
            for (let i = 0; i < rs.rows.length; i++) {
              rows.push(rs.rows.item(i));
            }
          }
          resolve(rows);
        },
        (_tx: any, err: any) => reject(new Error(`SQL error: ${JSON.stringify(err)}`))
      );
    });
  }

  // sql.js
  try {
    const results: any[] = [];
    const stmt = dbInstance.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  } catch (e) {
    logger.error('selectSql failed', { sql: sql.slice(0, 80), error: String(e) });
    throw e;
  }
}

export async function runInTransaction(fn: (exec: typeof executeSql) => Promise<void>): Promise<void> {
  if (dbIsAppPlatform) {
    // Plan B: raw BEGIN/COMMIT/ROLLBACK (Phase 3 驗證)
    await executeSql('BEGIN TRANSACTION', []);
    try {
      await fn(executeSql);
      await executeSql('COMMIT', []);
    } catch (e) {
      await executeSql('ROLLBACK', []);
      throw e;
    }
  } else {
    // sql.js: db.run() auto-commits each statement.
    // No explicit BEGIN/COMMIT needed — just run the function.
    // For batch operations, use db.exec() with concatenated SQL.
    await fn(executeSql);
  }
}

/** 導出數據庫二進制（僅 sql.js 模式有效） */
export function exportDatabase(): Uint8Array | null {
  if (dbIsAppPlatform || !dbInstance) return null;
  try {
    return dbInstance.export();
  } catch { return null; }
}
