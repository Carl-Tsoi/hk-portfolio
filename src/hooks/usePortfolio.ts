/**
 * T4: 全局狀態層
 * 單例 Ref，所有頁面共享
 */
import { ref, type Ref } from 'vue';
import Big from 'big.js';
import { selectSql } from '@/utils/db';
import {
  calculatePositions,
  batchFetchQuotes,
} from '@/services/portfolioService';
import { createLogger } from '@/utils/logger';
import type { Position, SortKey } from '@/types';

// Vue Proxy-safe numeric conversion for Big instances
function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = typeof v.toString === 'function' ? v.toString() : String(v);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

const logger = createLogger('usePortfolio');

// ===== Global singleton Refs =====
export const totalAsset = ref('0.00');
export const totalMarketValue = ref('0.00');
export const todayProfit = ref('0.00');
export const todayReturnRate = ref('0.00%');
export const totalProfit = ref('0.00');
export const totalReturnRate = ref('0.00%');
export const realizedProfit = ref('0.00');
export const netInvested = ref('0.00');
export const availableCash = ref('0.00');
export const lastQuoteUpdateTime = ref('');
export const positionList = ref<Position[]>([]);
export const isLoading = ref(false);

// Non-reactive state shared across pages
export let cycleMap = new Map<string, number>();

// ===== Sort =====
let currentSortKey: SortKey = 'market_value';

export function sortPositions(key: SortKey): void {
  currentSortKey = key;
  const list = [...positionList.value];
  if (key === 'market_value') {
    list.sort((a, b) => b.market_value.cmp(a.market_value) || a.stock_code.localeCompare(b.stock_code));
  } else if (key === 'profit_loss') {
    list.sort((a, b) => b.profit_loss.cmp(a.profit_loss) || a.stock_code.localeCompare(b.stock_code));
  } else if (key === 'ratio') {
    list.sort((a, b) => parseFloat(b.ratio) - parseFloat(a.ratio) || a.stock_code.localeCompare(b.stock_code));
  }
  positionList.value = list;
}

// ===== Refresh =====
export async function refreshPortfolioData(): Promise<void> {
  try {
    // Read cash
    const cashRows = await selectSql('SELECT available_cash FROM cash_account WHERE id = 1', []) as any[];
    const cash = cashRows[0]?.available_cash || '0.00';
    availableCash.value = cash;

    // Calculate positions
    const { positions, cycleMap: cm } = await calculatePositions();
    cycleMap = cm;

    // Calculate derived metrics
    const cashBig = new Big(cash);
    let totalMv = new Big(0);
    let unrealizedPL = new Big(0);
    let todayPL = new Big(0);
    let netInv = new Big(0);

    // Get all transactions for netInvested calculation
    const allTx = await selectSql('SELECT * FROM transactions', []) as any[];

    for (const tx of allTx) {
      const price = new Big(tx.price || '0');
      const qty = new Big(tx.quantity || '0');
      const fee = new Big(tx.fee || '0');

      if (tx.type === 'BUY') {
        netInv = netInv.plus(price.times(qty).plus(fee));
      } else if (tx.type === 'SELL') {
        netInv = netInv.minus(price.times(qty).minus(fee));
      } else if (tx.type === 'DIVIDEND') {
        netInv = netInv.minus(price.minus(fee));
      }
    }

    // Calculate position metrics
    for (const pos of positions) {
      totalMv = totalMv.plus(toNum(pos.market_value));
      unrealizedPL = unrealizedPL.plus(toNum(pos.profit_loss));

      const yesterdayClose = toNum(pos.yesterday_close);
      todayPL = todayPL.plus(
        (toNum(pos.current_price) - yesterdayClose) * toNum(pos.quantity)
      );

      // Ratio % of total portfolio
      const tMvNum = toNum(totalMv);
      pos.ratio = tMvNum === 0 ? '0.0%' : (toNum(pos.market_value) / tMvNum * 100).toFixed(1) + '%';
    }

    const totalAssetBig = cashBig.plus(toNum(totalMv));
    const totalProfitBig = totalAssetBig.minus(netInv);
    const realizedPL = totalProfitBig.minus(toNum(unrealizedPL));

    // Update refs
    totalAsset.value = totalAssetBig.toFixed(2);
    totalMarketValue.value = totalMv.toFixed(2);
    todayProfit.value = todayPL.toFixed(2);
    totalProfit.value = totalProfitBig.toFixed(2);
    realizedProfit.value = realizedPL.toFixed(2);
    netInvested.value = netInv.toFixed(2);

    // Return rates (use +num conversion for comparison)
    const tMvNum2 = +totalMv.toString();
    const todayPLNum = +todayPL.toString();
    const tpNum = +totalProfitBig.toString();
    const niNum = +netInv.toString();

    todayReturnRate.value = tMvNum2 === 0 ? '0.00%'
      : (todayPLNum >= 0 ? '+' : '') + (todayPLNum / tMvNum2 * 100).toFixed(2) + '%';

    totalReturnRate.value = niNum === 0 ? '0.00%'
      : (tpNum >= 0 ? '+' : '') + (tpNum / niNum * 100).toFixed(2) + '%';

    // Last quote update time
    const timeRows = await selectSql('SELECT MAX(updated_at) as t FROM stocks', []) as any[];
    const t = timeRows[0]?.t;
    lastQuoteUpdateTime.value = t ? t.slice(11, 19) : ''; // HH:MM:SS

    // Sort and set
    positionList.value = positions;
    sortPositions(currentSortKey);

  } catch (e) {
    logger.error('refreshPortfolioData failed', { error: String(e) });
  }
}

export async function refreshMarketQuotes(): Promise<void> {
  if (isLoading.value) return;

  isLoading.value = true;
  try {
    await batchFetchQuotes();
    await refreshPortfolioData();
    // Toast handled by caller (page)
  } catch (e: any) {
    if (e.message === 'NO_STOCKS') {
      // Toast in page
      throw new Error('NO_STOCKS');
    }
    if (e.message === 'ALL_FAILED') {
      throw new Error('ALL_FAILED');
    }
    logger.error('refreshMarketQuotes failed', { error: String(e) });
    throw e;
  } finally {
    isLoading.value = false;
  }
}

export function usePortfolio() {
  return {
    totalAsset,
    totalMarketValue,
    todayProfit,
    todayReturnRate,
    totalProfit,
    totalReturnRate,
    realizedProfit,
    netInvested,
    availableCash,
    lastQuoteUpdateTime,
    positionList,
    isLoading,
    refreshPortfolioData,
    refreshMarketQuotes,
    sortPositions,
  };
}
