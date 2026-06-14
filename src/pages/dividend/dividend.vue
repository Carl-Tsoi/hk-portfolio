<template>
  <div class="page">
    <div class="navbar">
      <button class="back-btn" @click="goBack">← 返回</button>
      <span class="navbar-title">录入分红</span>
      <span style="width:50px"></span>
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
      <div v-if="selectedName" class="stock-info">✅ {{ selectedName }}<span v-if="holdingInfo" class="holding-info">当前持仓：{{ holdingInfo }}</span></div>
    </div>
    <div class="form-row">
      <div class="form-half"><div class="form-label">分红总额</div><input v-model="dividendAmount" class="form-input" type="number" step="any" placeholder="HKD" @input="calcPreview" /></div>
      <div class="form-half"><div class="form-label">扣税/手续费</div><input v-model="taxAmount" class="form-input" type="number" step="any" placeholder="0" @input="calcPreview" /></div>
    </div>
    <div v-if="previewNetAmount" class="preview-card">
      <div class="preview-title">📌 实收分红净额：HKD {{ previewNetAmount }}</div>
      <div class="preview-detail">除权后持仓均价：{{ previewNewAvg }}</div>
      <div class="preview-detail">（原均价 {{ previewOldAvg }} ↓ {{ previewDiff }}）</div>
      <div v-if="previewIsNegative" class="preview-negative">持仓成本已完全回本</div>
    </div>
    <div class="form-note">此操作不会改变您的持股数量。分红净额将加入可用现金，同时从持仓成本中扣除（除权）。</div>
    <div class="form-row">
      <div class="form-half"><div class="form-label">除权日期</div><input v-model="tradeDate" class="form-input" type="date" :max="today" /></div>
      <div class="form-half"><div class="form-label">备注</div><input v-model="remark" class="form-input" placeholder="可选" maxlength="200" /></div>
    </div>
    <button class="btn-gold" style="width:calc(100% - 30px);margin:24px 15px;border:none;cursor:pointer;font-size:16px;padding:12px" :disabled="submitting" @click="handleSubmit">{{ submitting ? '提交中...' : '确认录入分红' }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import Big from 'big.js';
import { searchStockUniverse, addTransaction } from '@/services/portfolioService';
import { refreshPortfolioData, positionList } from '@/hooks/usePortfolio';
import type { StockInfo } from '@/types';

const stockCodeInput = ref(''); const selectedName = ref(''); const formattedCode = ref('');
const searchResults = ref<StockInfo[]>([]);
const dividendAmount = ref(''); const taxAmount = ref('0');
const tradeDate = ref(new Date().toISOString().slice(0, 10)); const remark = ref(''); const submitting = ref(false);
const today = new Date().toISOString().slice(0, 10);
const previewNetAmount = ref(''); const previewNewAvg = ref(''); const previewOldAvg = ref(''); const previewDiff = ref(''); const previewIsNegative = ref(false);

const holdingInfo = computed(() => { if (!formattedCode.value) return ''; const p = positionList.value.find(p => p.stock_code === formattedCode.value); return p ? `${p.quantity.toString()} 股 | 均价：${(+p.avg_price.toString()).toFixed(2)}` : ''; });

function calcPreview() {
  if (!dividendAmount.value || !formattedCode.value) { previewNetAmount.value = ''; return; }
  const p = positionList.value.find(p => p.stock_code === formattedCode.value);
  if (!p) { previewNetAmount.value = ''; return; }
  const net = new Big(dividendAmount.value || '0').minus(new Big(taxAmount.value || '0'));
  previewNetAmount.value = net.toFixed(2);
  previewOldAvg.value = (+p.total_cost.div(p.quantity).toString()).toFixed(2);
  const newAvg = p.total_cost.minus(net).div(p.quantity);
  previewNewAvg.value = (+newAvg.toString()).toFixed(2);
  previewDiff.value = (+p.total_cost.div(p.quantity).minus(newAvg).toString()).toFixed(2);
  previewIsNegative.value = newAvg.lt(0);
}

function goBack() { window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'index', url: '' } })); }
async function onSearch() { selectedName.value = ''; formattedCode.value = ''; if (stockCodeInput.value.length >= 1) searchResults.value = await searchStockUniverse(stockCodeInput.value); else searchResults.value = []; }
function selectStock(s: StockInfo) { formattedCode.value = s.stock_code; stockCodeInput.value = s.stock_code; selectedName.value = s.stock_name; searchResults.value = []; calcPreview(); }

async function handleSubmit() {
  if (!formattedCode.value) { alert('请选择股票代码'); return; }
  if (!dividendAmount.value || +dividendAmount.value <= 0) { alert('请输入有效的分红总额'); return; }
  if (+(taxAmount.value||'0') >= +dividendAmount.value) { alert('扣税金额不能超过分红总额'); return; }
  if (tradeDate.value > today) { alert('除权日期不能晚于今天'); return; }
  submitting.value = true;
  try {
    await addTransaction({ stock_code: formattedCode.value, type: 'DIVIDEND', trade_date: tradeDate.value, price: dividendAmount.value, quantity: '0', fee: taxAmount.value || '0', remark: remark.value || undefined });
    await refreshPortfolioData();
    alert('分红已录入'); goBack();
  } catch { alert('录入失败'); }
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
