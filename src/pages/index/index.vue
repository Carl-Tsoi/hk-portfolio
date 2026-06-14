<template>
  <div class="page">
    <!-- Navbar -->
    <div class="navbar">
      <span class="navbar-title">持仓</span>
      <div class="navbar-actions">
        <button class="nav-btn" @click="handleRefreshQuotes" :disabled="isLoading" title="同步行情">
          <span :class="isLoading ? 'spinner' : ''">🔄</span>
        </button>
        <button class="nav-btn" @click="goAdmin" title="后台管理">⚙️</button>
      </div>
    </div>

    <!-- Asset Card -->
    <div class="asset-card">
      <div class="total-label">总资产 (HKD)</div>
      <div class="total-number">{{ totalAsset }}</div>

      <div class="row-between">
        <div>
          <div class="metric-label">总市值</div>
          <div class="metric-value">{{ totalMarketValue }}</div>
        </div>
        <div class="right">
          <div class="metric-label">可用现金</div>
          <div :class="['metric-value', isCashNegative ? 'text-red-bright' : '']">{{ availableCash }}</div>
        </div>
      </div>

      <div class="pl-grid">
        <div class="pl-row">
          <div><div class="pl-label">今日盈亏</div><div :class="['pl-value', isTodayPositive ? 'text-red-bright' : 'text-green-bright']">{{ todayProfit }}</div></div>
          <div class="right"><div class="pl-label">今日收益率</div><div :class="['pl-value', isTodayPositive ? 'text-red-bright' : 'text-green-bright']">{{ todayReturnRate }}</div></div>
        </div>
        <div class="pl-row">
          <div><div class="pl-label">累计盈亏</div><div :class="['pl-value', isTotalPositive ? 'text-red-bright' : 'text-green-bright']">{{ totalProfit }}</div></div>
          <div class="right"><div class="pl-label">累计收益率</div><div :class="['pl-value', isTotalPositive ? 'text-red-bright' : 'text-green-bright']">{{ totalReturnRate }}</div></div>
        </div>
        <div class="pl-row secondary">
          <div><div class="pl-label">已实现盈亏</div><div class="pl-value-secondary">{{ realizedProfit }}</div></div>
          <div class="right"><div class="pl-label">净投入</div><div class="pl-value-secondary">{{ netInvested }}</div></div>
        </div>
      </div>

      <div class="update-time">行情更新：{{ lastQuoteUpdateTime || '—' }}</div>
    </div>

    <!-- Position List Header -->
    <div class="list-header">
      <span class="col-left" @click="sortPositions('market_value')" style="cursor:pointer">代码/名称 ▼</span>
      <span class="col-mid" @click="sortPositions('profit_loss')" style="cursor:pointer">盈亏</span>
      <span class="col-right" @click="sortPositions('ratio')" style="cursor:pointer">持仓</span>
    </div>

    <!-- Empty State -->
    <div v-if="positionList.length === 0" class="empty-state">
      <div class="empty-icon">📊</div>
      <div class="empty-text">暂无持仓</div>
      <div class="empty-sub">点击下方按钮开始你的第一笔交易</div>
    </div>

    <!-- Position List -->
    <div v-for="pos in positionList" :key="pos.stock_code" class="position-item" @click="openPopup(pos.stock_code)">
      <div class="pos-row1">
        <div class="pos-code-name">
          <span class="courier-bold-code">{{ pos.stock_code }}</span>
          <span class="stock-name-sub">{{ pos.stock_name }}</span>
        </div>
        <span class="pos-ratio">{{ pos.ratio }}</span>
      </div>
      <div class="pos-row2">
        <div class="col-left">
          <span :class="['price-main', isPriceUp(pos) ? 'text-red' : 'text-green']">{{ fmt(pos.current_price) }}</span>
          <span :class="['change-rate', isPriceUp(pos) ? 'text-red' : 'text-green']">{{ pos.change_rate }}</span>
        </div>
        <div class="col-mid">
          <span :class="['pl-main', isCostPositive(pos) ? 'text-red' : 'text-green']">{{ fmtPL(pos.profit_loss) }}</span>
          <span :class="['pl-pct', isCostPositive(pos) ? 'text-red' : 'text-green']">{{ pos.profit_loss_pct }}</span>
        </div>
        <div class="col-right">
          <span class="qty-main">{{ fmtQty(pos.quantity) }} 股</span>
        </div>
      </div>
      <div class="pos-row3">
        <span class="pos-sub">均 {{ fmt(pos.avg_price) }}</span>
        <span class="pos-sub right">今盈 {{ fmtPL(pos.today_profit) }}</span>
        <span class="pos-sub right">市值 {{ fmtMV(pos.market_value) }}</span>
      </div>
    </div>

    <!-- Bottom Actions -->
    <div class="bottom-actions">
      <button class="btn-red" @click="goTrade">买卖股票</button>
      <button class="btn-gold" @click="goDividend">录入分红</button>
    </div>

    <!-- Stock Popup -->
    <tx-popup
      :visible="popupVisible"
      :stock-code="selectedStock"
      :cycle-start-id="cycleMap.get(selectedStock) || null"
      @close="popupVisible = false"
      @navigate-trade="goTradeWithCode"
      @navigate-dividend="goDividendWithCode"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { usePortfolio, cycleMap } from '@/hooks/usePortfolio';
import txPopup from '@/components/tx-popup/tx-popup.vue';

const {
  totalAsset, totalMarketValue, todayProfit, todayReturnRate,
  totalProfit, totalReturnRate, realizedProfit, netInvested,
  availableCash, lastQuoteUpdateTime, positionList, isLoading,
  refreshPortfolioData, refreshMarketQuotes, sortPositions,
} = usePortfolio();

const popupVisible = ref(false);
const selectedStock = ref('');

const isCashNegative = computed(() => parseFloat(availableCash.value) < 0);
const isTodayPositive = computed(() => !todayProfit.value.startsWith('-'));
const isTotalPositive = computed(() => !totalProfit.value.startsWith('-'));

// Vue 3 Proxy wraps Big instances — use numeric conversion for all comparisons
function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  // Big instance (possibly Proxy-wrapped): use toString()
  const s = typeof v.toString === 'function' ? v.toString() : String(v);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isPriceUp(pos: any) {
  return toNum(pos.current_price) >= toNum(pos.yesterday_close);
}
function isCostPositive(pos: any) {
  const tc = toNum(pos.total_cost);
  if (tc < 0) return true;  // cost fully recovered
  return toNum(pos.market_value) >= tc;
}

function fmt(v: any) { return toNum(v).toFixed(2); }
function fmtPL(v: any) { const n = toNum(v); return (n >= 0 ? '+' : '') + n.toFixed(2); }
function fmtQty(v: any) { return typeof v.toString === 'function' ? v.toString() : String(v); }
function fmtMV(v: any) {
  const n = toNum(v);
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (n >= 1e6) return (n / 1e4).toFixed(1) + '万';
  return n.toFixed(2);
}

function goTrade() { (window as any).__pageParams = {}; window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'trade', url: '' } })); }
function goDividend() { window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'dividend', url: '' } })); }
function goTradeWithCode(code: string) {
  (window as any).__pageParams = { stock_code: code };
  window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'trade', url: `?stock_code=${code}` } }));
}
function goDividendWithCode(code: string) {
  (window as any).__pageParams = { stock_code: code };
  window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'dividend', url: `?stock_code=${code}` } }));
}
function goAdmin() { window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'admin', url: '' } })); }
function openPopup(code: string) { selectedStock.value = code; popupVisible.value = true; }

async function handleRefreshQuotes() {
  if (isLoading.value) return;
  try {
    await refreshMarketQuotes();
    alert('行情已刷新');
  } catch (e: any) {
    if (e.message === 'NO_STOCKS') alert('暂无股票数据，请先录入交易');
    else alert('刷新失败，请检查网络');
  }
}

onMounted(async () => { await refreshPortfolioData(); });
</script>

<style scoped>
.page { padding-bottom: 10px; }
.navbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 15px; background: #fff; border-bottom: 1px solid #eee;
  position: sticky; top: 0; z-index: 50;
}
.navbar-title { font-size: 17px; font-weight: 600; }
.navbar-actions { display: flex; gap: 4px; }
.nav-btn {
  background: none; border: none; font-size: 20px; cursor: pointer;
  padding: 4px 8px; border-radius: 4px;
}
.nav-btn:hover { background: #f0f0f0; }
.nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.col-left { flex: 3.5; display: flex; flex-direction: column; }
.col-mid { flex: 3; text-align: right; }
.col-right { flex: 3.5; text-align: right; }
</style>
