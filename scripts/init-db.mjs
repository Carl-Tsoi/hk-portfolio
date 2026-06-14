#!/usr/bin/env node
/**
 * T2c: 數據庫種子腳本 — 生成 public/hk_portfolio_db.db
 * 使用 sql.js 在 Node.js 中創建 SQLite 數據庫
 * 執行: node scripts/init-db.mjs
 */
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = resolve(ROOT, 'public');
const JSON_PATH = resolve(ROOT, 'src/data/stock_universe.json');
const PUBLIC_DB = resolve(PUBLIC_DIR, 'hk_portfolio_db.db');

const DDL = [
  `CREATE TABLE IF NOT EXISTS stocks (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL,
    current_price TEXT DEFAULT '0.00',
    yesterday_close TEXT DEFAULT '0.00',
    updated_at TEXT
  )`,
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
  `CREATE TABLE IF NOT EXISTS cash_account (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    available_cash TEXT DEFAULT '0.00',
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS stock_universe (
    stock_code TEXT PRIMARY KEY,
    stock_name TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`,
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_tx_stock_code ON transactions(stock_code)`,
  `CREATE INDEX IF NOT EXISTS idx_tx_date_created ON transactions(trade_date ASC, created_at ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_universe_code ON stock_universe(stock_code)`,
];

async function main() {
  console.log('[init-db] Starting...');
  const SQL = await initSqlJs();

  // Create database
  const db = new SQL.Database();

  // Run DDL
  for (const sql of DDL) {
    db.run(sql);
  }
  console.log('[init-db] DDL complete (5 tables)');

  // Run indexes
  for (const sql of INDEXES) {
    db.run(sql);
  }
  console.log('[init-db] Indexes created (3)');

  // Initialize cash_account
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.run("INSERT INTO cash_account (id, available_cash, updated_at) VALUES (1, '0.00', ?)", [now]);
  console.log("[init-db] cash_account initialized (id=1, cash='0.00')");

  // Import stock_universe from JSON
  try {
    const jsonData = readFileSync(JSON_PATH, 'utf-8');
    const stocks = JSON.parse(jsonData);
    if (Array.isArray(stocks) && stocks.length > 0) {
      db.run('BEGIN TRANSACTION');
      const BATCH = 500;
      for (let i = 0; i < stocks.length; i += BATCH) {
        const batch = stocks.slice(i, i + BATCH);
        for (const s of batch) {
          db.run('INSERT OR IGNORE INTO stock_universe (stock_code, stock_name) VALUES (?, ?)',
            [s.stock_code, s.stock_name]);
        }
      }
      db.run('COMMIT');
      console.log(`[init-db] stock_universe: ${stocks.length} stocks imported from JSON`);
    }
  } catch (e) {
    console.warn('[init-db] stock_universe.json not found or empty, skipping import');
  }

  // Write schema version
  db.run('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)', [1, now]);

  // Export and write
  const data = db.export();
  const buffer = Buffer.from(data);

  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR);
  writeFileSync(PUBLIC_DB, buffer);

  console.log(`[init-db] Database written:`);
  console.log(`  ${PUBLIC_DB} (${buffer.length} bytes)`);
  console.log('[init-db] Done.');
  db.close();
}

main().catch((e) => {
  console.error('[init-db] Failed:', e);
  process.exit(1);
});
