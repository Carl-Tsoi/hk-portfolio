<template>
  <div class="page">
    <div class="navbar">
      <button class="back-btn" @click="goBack">← 返回</button>
      <span class="navbar-title">股票交易</span>
      <span style="width:50px"></span>
    </div>
    <div class="tab-bar">
      <div :class="['tab', tradeType==='BUY'?'tab-active-buy':'']" @click="tradeType='BUY'">买入</div>
      <div :class="['tab', tradeType==='SELL'?'tab-active-sell':'']" @click="tradeType='SELL'">卖出</div>
    </div>
    <div class="form-group">
      <div class="form-label">股票代码</div>
      <input v-model="stockCodeInput" class="form-input" placeholder="输入代码如 700" @input="onSearch" />
      <div v-if="searchResults.length > 0" class="search-dropdown">
        <div v-for="s in searchResults" :key="s.stock_code" class="search-item" @click="selectStock(s)">
          <span class="courier-bold-code">{{ s.stock_code }}</span>
          <span class="stock-name-sub">{{ s.stock_name }}</span>
        </div>
      </div>
      <div v-if="stockCodeInput && searchResults.length===0 && !selectedName" class="input-error-hint">无匹配股票</div>
      <div v-if="selectedName" class="stock-info">✅ {{ selectedName }}<span v-if="holdingInfo" class="holding-info">当前持仓：{{ holdingInfo }}</span></div>
    </div>
    <div class="form-row">
      <div class="form-half"><div class="form-label">数量</div><input v-model="quantity" class="form-input" type="number" step="any" placeholder="交易数量" /><div v-if="tradeType==='SELL' && holdingQty" style="font-size:11px;color:#999;margin-top:2px">卖出后剩余：{{ remainQty }} 股</div></div>
      <div class="form-half"><div class="form-label">单价</div><input v-model="price" class="form-input" type="number" step="any" placeholder="成交单价" /></div>
    </div>
    <div class="form-row">
      <div class="form-half"><div class="form-label">手续费</div><input v-model="fee" class="form-input" type="number" step="any" placeholder="0" /></div>
      <div class="form-half"><div class="form-label">交易日期</div><input v-model="tradeDate" class="form-input" type="date" :max="today" /></div>
    </div>
    <div class="form-group"><div class="form-label">备注</div><textarea v-model="remark" class="form-textarea" placeholder="可选，最多200字" maxlength="200"></textarea></div>
    <button :class="tradeType==='BUY'?'btn-red':''" :style="tradeType==='SELL'?'background:#24a148;color:#fff;border-radius:8px;padding:12px 24px;text-align:center;font-size:16px;font-weight:bold;width:calc(100% - 30px);margin:24px 15px;border:none;cursor:pointer':''" :disabled="submitting" @click="handleSubmit">{{ submitting ? '提交中...' : (tradeType==='BUY' ? '确认买入' : '确认卖出') }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Big from 'big.js';
import { searchStockUniverse, addTransaction, formatStockCode } from '@/services/portfolioService';
import { refreshPortfolioData, positionList } from '@/hooks/usePortfolio';
import type { StockInfo } from '@/types';

const tradeType = ref<'BUY' | 'SELL'>('BUY');
const stockCodeInput = ref('');
const selectedName = ref('');
const formattedCode = ref('');
const searchResults = ref<StockInfo[]>([]);
const quantity = ref('');
const price = ref('');
const fee = ref('0');
const tradeDate = ref(new Date().toISOString().slice(0, 10));
const remark = ref('');
const submitting = ref(false);
const today = new Date().toISOString().slice(0, 10);

const holdingQty = computed(() => { if (tradeType.value !== 'SELL' || !formattedCode.value) return ''; const p = positionList.value.find(p => p.stock_code === formattedCode.value); return p ? p.quantity.toString() : ''; });
const remainQty = computed(() => { if (!holdingQty.value || !quantity.value) return ''; return new Big(holdingQty.value).minus(new Big(quantity.value || '0')).toString(); });
const holdingInfo = computed(() => { if (!holdingQty.value) return ''; const p = positionList.value.find(p => p.stock_code === formattedCode.value); return `${holdingQty.value} 股 | 均价：${p ? (+p.avg_price.toString()).toFixed(2) : '—'}`; });

function goBack() { window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'index', url: '' } })); }
async function onSearch() { selectedName.value = ''; formattedCode.value = ''; if (stockCodeInput.value.length >= 1) searchResults.value = await searchStockUniverse(stockCodeInput.value); else searchResults.value = []; }
function selectStock(s: StockInfo) { formattedCode.value = s.stock_code; stockCodeInput.value = s.stock_code; selectedName.value = s.stock_name; searchResults.value = []; }

async function handleSubmit() {
  const code = formattedCode.value || formatStockCode(stockCodeInput.value);
  if (!code || !/^\d{5}$/.test(code)) { alert('请选择或输入有效的港股代码'); return; }
  if (!quantity.value || +quantity.value <= 0) { alert('请输入有效的交易数量'); return; }
  if (!price.value || +price.value <= 0) { alert('请输入有效的交易单价'); return; }
  if (tradeDate.value > today) { alert('交易日期不能晚于今天'); return; }
  if (tradeType.value === 'SELL') { const p = positionList.value.find(p => p.stock_code === code); if (!p) { alert('当前没有该股票的持仓，无法卖出'); return; } if (new Big(quantity.value).gt(p.quantity)) { alert(`卖出数量超过当前持仓（${p.quantity.toString()} 股）`); return; } if (new Big(quantity.value).eq(p.quantity) && !confirm('卖出后该股票将清仓，持仓成本将重置。确定继续？')) return; }
  submitting.value = true;
  try {
    await addTransaction({ stock_code: code, type: tradeType.value, trade_date: tradeDate.value, price: price.value, quantity: quantity.value, fee: fee.value || '0', remark: remark.value || undefined });
    await refreshPortfolioData();
    alert(tradeType.value === 'BUY' ? '买入成功' : '卖出成功');
    goBack();
  } catch { alert('提交失败，请重试'); }
  finally { submitting.value = false; }
}

onMounted(() => { const params = (window as any).__pageParams || {}; if (params?.stock_code) { formattedCode.value = params.stock_code; stockCodeInput.value = params.stock_code; searchStockUniverse(params.stock_code).then(r => { const m = r.find(s => s.stock_code === params.stock_code); if (m) selectedName.value = m.stock_name; }); } });
</script>

<style scoped>
.page { padding-bottom: 10px; }
.navbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #fff; border-bottom: 1px solid #eee; }
.navbar-title { font-size: 17px; font-weight: 600; }
.back-btn { background: none; border: none; color: #1e3c72; font-size: 15px; cursor: pointer; padding: 4px 8px; }
</style>
