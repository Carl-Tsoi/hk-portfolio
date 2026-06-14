#!/usr/bin/env node
/**
 * T2d: 港股列表下載腳本
 * 從港交所下載 xlsx → 解析 → 過濾 → 輸出 stock_universe.json
 * 執行: node scripts/download-hkex.mjs
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT = resolve(ROOT, 'src/data/stock_universe.json');

const HKEX_URL = 'https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx';

// 保留的分類
const INCLUDE_CATEGORIES = ['股本', '交易所買賣產品', '房地產投資信託基金'];
// 排除的分類
const EXCLUDE_CATEGORIES = ['衍生權證', '牛熊證', '債券', '股本權證', '股本權證(主板)', '股本權證(創業板)'];

function isRmbCounter(code, name) {
  // 人民幣櫃台：名稱含「－Ｒ」或「－WR」，代碼通常尾號為8
  if (name.includes('－Ｒ') || name.includes('－WR') || name.includes('－R')) return true;
  return false;
}

async function main() {
  console.log('[download-hkex] Downloading HKEX securities list...');
  console.log(`  URL: ${HKEX_URL}`);

  // 動態導入 xlsx（Node.js 環境）
  const XLSX = await import('xlsx');

  // Download
  const resp = await fetch(HKEX_URL);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  console.log(`  Downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

  // Parse
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Fix merged cell ref
  const keys = Object.keys(sheet).filter(k => !k.startsWith('!'));
  let maxRow = 0;
  keys.forEach(k => {
    const match = k.match(/([A-Z]+)(\d+)/);
    if (match) maxRow = Math.max(maxRow, parseInt(match[2]));
  });
  sheet['!ref'] = `A1:R${maxRow}`;

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  console.log(`  Parsed: ${rows.length} rows (incl. headers)`);

  // Filter
  const stocks = [];
  for (let i = 3; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const category = String(row[2] || '').trim();

    if (!code || !name) continue;
    if (!INCLUDE_CATEGORIES.includes(category)) continue;
    if (isRmbCounter(code, name)) continue;

    stocks.push({
      stock_code: code.padStart(5, '0'),
      stock_name: name,
    });
  }

  // Sort by code
  stocks.sort((a, b) => a.stock_code.localeCompare(b.stock_code));

  // Write
  writeFileSync(OUTPUT, JSON.stringify(stocks, null, 2), 'utf-8');
  console.log(`[download-hkex] Done. ${stocks.length} stocks written to:`);
  console.log(`  ${OUTPUT}`);
  console.log('');
  console.log('Next: run "node scripts/init-db.mjs" to import into database.');
}

main().catch((e) => {
  console.error('[download-hkex] Failed:', e.message);
  process.exit(1);
});
