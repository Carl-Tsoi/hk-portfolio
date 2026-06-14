/**
 * T3: 業務邏輯層
 * 港股持倉計算、交易寫入、行情刷新
 */
import Big from 'big.js';
import { executeSql, selectSql, runInTransaction } from '@/utils/db';
import { createLogger } from '@/utils/logger';
import type { TxInput, Position, StockInfo, CalculatePositionsResult } from '@/types';

const logger = createLogger('portfolioService');

// ===== 代碼格式化 =====

/** 格式化為 5 位等寬字串 */
export function formatStockCode(input: string): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(5, '0');
}

/** 轉為 Yahoo v8 格式（去掉一個前導零 + .HK） */
export function toYahooCode(code: string): string {
  const formatted = formatStockCode(code);
  // 去掉一個前導零
  const trimmed = formatted.replace(/^0/, '');
  return `${trimmed}.HK`;
}

// ===== 模糊搜索 =====

export async function searchStockUniverse(keyword: string): Promise<StockInfo[]> {
  if (!keyword || !keyword.trim()) return [];
  const digits = keyword.replace(/\D/g, '');
  if (!digits) return [];

  const rows = await selectSql(
    "SELECT stock_code, stock_name FROM stock_universe WHERE stock_code LIKE '%' || ? || '%' LIMIT 20",
    [digits]
  ) as StockInfo[];
  return rows;
}

// ===== 交易寫入 =====

export async function addTransaction(tx: TxInput): Promise<{ id: number; cash_impact: string }> {
  // 計算 cash_impact
  const price = new Big(tx.price);
  const qty = new Big(tx.quantity);
  const fee = new Big(tx.fee || '0');

  let cashImpact: Big;
  if (tx.type === 'BUY') {
    cashImpact = price.times(qty).plus(fee).times(-1);
  } else if (tx.type === 'SELL') {
    cashImpact = price.times(qty).minus(fee);
  } else {
    // DIVIDEND: price = 分紅總額, fee = 扣稅
    cashImpact = price.minus(fee);
  }

  const cashImpactStr = cashImpact.toString();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let newId: number;

  await runInTransaction(async (exec) => {
    // Ensure stock exists in stocks table
    const existing = await selectSql('SELECT stock_code FROM stocks WHERE stock_code = ?', [tx.stock_code]) as any[];
    if (existing.length === 0) {
      // Try to get name from stock_universe, fall back to code
      const uni = await selectSql('SELECT stock_name FROM stock_universe WHERE stock_code = ?', [tx.stock_code]) as any[];
      const name = uni[0]?.stock_name || tx.stock_code;
      await exec(
        "INSERT INTO stocks (stock_code, stock_name) VALUES (?, ?)",
        [tx.stock_code, name]
      );
    }

    // Insert transaction
    await exec(
      `INSERT INTO transactions (stock_code, type, trade_date, price, quantity, fee, cash_impact, remark, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tx.stock_code, tx.type, tx.trade_date, tx.price, tx.quantity, tx.fee || '0', cashImpactStr, tx.remark || null, now]
    );

    // Get the auto-incremented id
    const idRows = await selectSql('SELECT last_insert_rowid() as id', []) as any[];
    newId = idRows[0]?.id;

    // Update cash account
    await exec(
      "UPDATE cash_account SET available_cash = available_cash + ?, updated_at = ? WHERE id = 1",
      [cashImpactStr, now]
    );
  });

  logger.info(`${tx.type} ${tx.stock_code}`, { id: newId!, cash_impact: cashImpactStr });
  return { id: newId!, cash_impact: cashImpactStr };
}

// ===== 交易刪除 =====

export async function deleteTransaction(id: number): Promise<void> {
  await runInTransaction(async (exec) => {
    // Get cash_impact
    const rows = await selectSql('SELECT cash_impact FROM transactions WHERE id = ?', [id]) as any[];
    if (rows.length === 0) {
      logger.warn('deleteTransaction: id not found', { id });
      return;
    }
    const cashImpact = rows[0].cash_impact;

    // Reverse cash impact
    const reversed = new Big(cashImpact).times(-1).toString();
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    // Delete the transaction
    await exec('DELETE FROM transactions WHERE id = ?', [id]);

    // Update cash
    await exec(
      "UPDATE cash_account SET available_cash = available_cash + ?, updated_at = ? WHERE id = 1",
      [reversed, now]
    );
  });

  logger.info(`Transaction ${id} deleted`);
}

// ===== 持倉計算 =====

export async function calculatePositions(): Promise<CalculatePositionsResult> {
  const rows = await selectSql(
    'SELECT * FROM transactions ORDER BY trade_date ASC, created_at ASC, id ASC',
    []
  ) as any[];

  const positionMap = new Map<string, {
    quantity: Big;
    totalCost: Big;
    stockName: string;
    currentPrice: string;
    yesterdayClose: string;
  }>();

  const cycleMap = new Map<string, number>(); // stock_code → cycle start transaction id

  for (const tx of rows) {
    const code = tx.stock_code;
    let pos = positionMap.get(code);

    if (!pos) {
      // Get stock info from stocks table
      const stockRows = await selectSql(
        'SELECT stock_name, current_price, yesterday_close FROM stocks WHERE stock_code = ?',
        [code]
      ) as any[];
      pos = {
        quantity: new Big(0),
        totalCost: new Big(0),
        stockName: stockRows[0]?.stock_name || code,
        currentPrice: stockRows[0]?.current_price || '0',
        yesterdayClose: stockRows[0]?.yesterday_close || '0',
      };
      positionMap.set(code, pos);
    }

    const price = new Big(tx.price || '0');
    const qty = new Big(tx.quantity || '0');
    const fee = new Big(tx.fee || '0');

    if (tx.type === 'BUY') {
      pos.quantity = pos.quantity.plus(qty);
      pos.totalCost = pos.totalCost.plus(price.times(qty).plus(fee));
      // Track cycle start
      if (!cycleMap.has(code)) {
        cycleMap.set(code, tx.id);
      }
    } else if (tx.type === 'SELL') {
      const prevQty = pos.quantity;
      pos.quantity = pos.quantity.minus(qty);

      if (pos.quantity.eq(0)) {
        // 清倉重置
        pos.totalCost = new Big(0);
        cycleMap.delete(code);
      } else {
        // 成本等比減少
        const prevAvg = prevQty.eq(0) ? new Big(0) : pos.totalCost.div(prevQty);
        pos.totalCost = prevAvg.times(pos.quantity);
      }
    } else if (tx.type === 'DIVIDEND') {
      // 除以權：分紅淨額從成本扣除
      const netDividend = price.minus(fee);
      pos.totalCost = pos.totalCost.minus(netDividend);
    }
  }

  // Build position list (quantity > 0 only)
  const positions: Position[] = [];
  for (const [code, pos] of positionMap) {
    if (pos.quantity.lte(0)) continue;

    const currentPrice = new Big(pos.currentPrice || '0');
    const marketValue = currentPrice.times(pos.quantity);
    const profitLoss = marketValue.minus(pos.totalCost);
    const avgPrice = pos.quantity.eq(0) ? new Big(0) : pos.totalCost.div(pos.quantity);

    // 盈虧%
    const profitLossPct = pos.totalCost.eq(0)
      ? '0.00%'
      : (pos.totalCost.lt(0) ? '+' : '') + profitLoss.div(pos.totalCost.abs()).times(100).toFixed(2) + '%';

    // 漲跌幅%
    const yesterdayClose = new Big(pos.yesterdayClose || '0');
    const changeRate = yesterdayClose.eq(0)
      ? '0.00%'
      : currentPrice.minus(yesterdayClose).div(yesterdayClose).times(100).toFixed(2) + '%';

    // 今日盈虧
    const todayProfit = currentPrice.minus(yesterdayClose).times(pos.quantity);

    positions.push({
      stock_code: code,
      stock_name: pos.stockName,
      current_price: pos.currentPrice,
      yesterday_close: pos.yesterdayClose,
      quantity: pos.quantity,
      total_cost: pos.totalCost,
      avg_price: avgPrice,
      market_value: marketValue,
      profit_loss: profitLoss,
      profit_loss_pct: profitLossPct,
      today_profit: todayProfit,
      change_rate: changeRate,
      ratio: '', // filled by usePortfolio
    });
  }

  // Sort by market value descending
  positions.sort((a, b) => {
    const mvCmp = b.market_value.cmp(a.market_value);
    if (mvCmp !== 0) return mvCmp;
    return a.stock_code.localeCompare(b.stock_code);
  });

  return { positions, cycleMap };
}

// ===== 行情刷新 (Yahoo v8) =====

export async function batchFetchQuotes(): Promise<void> {
  const stocks = await selectSql('SELECT stock_code FROM stocks', []) as any[];
  if (stocks.length === 0) {
    throw new Error('NO_STOCKS');
  }

  const codes = stocks.map((s: any) => s.stock_code);
  let successCount = 0;
  let failCount = 0;

  // 逐隻請求（並發控制：每 200ms 一個，最多 3 並發）
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
  const CONCURRENCY = 3;

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (code, idx) => {
        await delay(idx * 200); // stagger by 200ms
        const yahooCode = toYahooCode(code);
        const url = getYahooApiUrl(yahooCode);
        return fetchOneQuote(code, url);
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failCount++;
        logger.warn(`Quote fetch failed for ${batch[results.indexOf(result)]}`, { error: String(result.reason) });
      }
    }
  }

  logger.info(`batchFetchQuotes: ${successCount} ok, ${failCount} failed`);

  if (successCount === 0) {
    throw new Error('ALL_FAILED');
  }
}

function getYahooApiUrl(yahooCode: string): string {
  // H5: use Vite proxy; App: direct
  if (typeof window !== 'undefined' && typeof (globalThis as any).plus === 'undefined') {
    return `/api/yahoo/v8/finance/chart/${yahooCode}?interval=1d&range=1d`;
  }
  return `https://query1.finance.yahoo.com/v8/finance/chart/${yahooCode}?interval=1d&range=1d`;
}

async function fetchOneQuote(code: string, url: string): Promise<void> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();

  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error('No meta in response');

  const price = String(meta.regularMarketPrice ?? '0');
  const prevClose = String(meta.previousClose ?? '0');
  const name = meta.longName || meta.shortName || '';
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  if (name) {
    await executeSql(
      'UPDATE stocks SET current_price = ?, yesterday_close = ?, stock_name = ?, updated_at = ? WHERE stock_code = ?',
      [price, prevClose, name, now, code]
    );
  } else {
    await executeSql(
      'UPDATE stocks SET current_price = ?, yesterday_close = ?, updated_at = ? WHERE stock_code = ?',
      [price, prevClose, now, code]
    );
  }
}

// ===== 港交所股票列表同步 =====

export async function syncStockListFromHKEX(source?: string | ArrayBuffer): Promise<number> {
  let buffer: ArrayBuffer;

  if (source instanceof ArrayBuffer) {
    // 直接传入的 ArrayBuffer（浏览器下载后传入）
    buffer = source;
  } else if (typeof source === 'string') {
    // URL 或文件路径
    const resp = await fetch(source);
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    buffer = await resp.arrayBuffer();
  } else {
    // 无参数：从港交所直接下载
    const url = typeof window !== 'undefined' && typeof (globalThis as any).plus === 'undefined'
      ? '/api/hkex/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx'
      : 'https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx';

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    buffer = await resp.arrayBuffer();
  }

  // Parse with SheetJS (dynamic import)
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Fix merged cell ref
  const keys = Object.keys(sheet).filter(k => !k.startsWith('!'));
  let maxRow = 0;
  keys.forEach(k => {
    const match = k.match(/([A-Z]+)(\d+)/);
    if (match) maxRow = Math.max(maxRow, parseInt(match[2]));
  });
  sheet['!ref'] = `A1:R${maxRow}`;

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];

  // Filter (same rules as download-hkex.mjs)
  const INCLUDE = ['股本', '交易所買賣產品', '房地產投資信託基金'];
  const stocks: StockInfo[] = [];

  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();

    if (!code || !name) continue;
    if (!INCLUDE.includes(category)) continue;
    // Exclude RMB counters
    if (name.includes('－Ｒ') || name.includes('－WR') || name.includes('－R')) continue;

    stocks.push({
      stock_code: code.padStart(5, '0'),
      stock_name: name,
    });
  }

  if (stocks.length === 0) throw new Error('No stocks parsed from file');

  // Import to stock_universe
  await runInTransaction(async (exec) => {
    await exec('DELETE FROM stock_universe', []);
    const BATCH = 500;
    for (let i = 0; i < stocks.length; i += BATCH) {
      const batch = stocks.slice(i, i + BATCH);
      for (const s of batch) {
        await exec(
          'INSERT INTO stock_universe (stock_code, stock_name) VALUES (?, ?)',
          [s.stock_code, s.stock_name]
        );
      }
    }
  });

  logger.info(`syncStockListFromHKEX: ${stocks.length} stocks imported`);
  return stocks.length;
}
