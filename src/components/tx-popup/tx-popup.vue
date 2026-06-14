<template>
  <div v-if="visible" class="popup-overlay" @click="close">
    <div class="popup-content" @click.stop>
      <div class="popup-close" @click="close">✕</div>
      <div class="popup-header">
        <span class="courier-bold-code">{{ stockCode }}</span>
        <span class="stock-name-sub">{{ stockName }}</span>
        <div v-if="posSummary" class="header-summary">
          <span>持仓 {{ posSummary.qty }} 股 | 均价 {{ posSummary.avg }}</span>
          <span :class="['header-pl', posSummary.pl >= 0 ? 'text-red' : 'text-green']">成本盈亏：{{ (posSummary.pl >= 0 ? '+' : '') + posSummary.pl.toFixed(2) }}</span>
        </div>
      </div>
      <div class="popup-body">
        <div v-if="txList.length === 0" class="empty-state" style="padding:30px 0"><span class="empty-text">暂无交易记录</span></div>
        <div v-for="tx in txList" :key="tx.id" class="popup-tx-item">
          <span class="ptx-date">{{ tx.trade_date.slice(5) }}</span>
          <span :class="['badge', tx.type==='BUY'?'badge-buy':tx.type==='SELL'?'badge-sell':'badge-dividend']">{{ tx.type }}</span>
          <span class="ptx-qty">{{ tx.type==='DIVIDEND'?'—':(tx.type==='SELL'?'-':'+')+tx.quantity }}</span>
          <span class="ptx-price">{{ tx.type==='DIVIDEND'?'—':'@'+(+tx.price).toFixed(2) }}</span>
          <span class="ptx-fee">{{ +tx.fee>0?(+tx.fee).toFixed(2):'—' }}</span>
          <span :class="['ptx-cash', +tx.cash_impact>=0?'text-green':'text-red']">{{ (+tx.cash_impact>=0?'+':'')+(+tx.cash_impact).toFixed(0) }}</span>
        </div>
      </div>
      <div class="popup-actions">
        <button class="btn-red" style="flex:1;border:none;cursor:pointer" @click="goTrade">去交易</button>
        <button class="btn-gold" style="flex:1;border:none;cursor:pointer" @click="goDividend">录入分红</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { selectSql } from '@/utils/db';
import { positionList } from '@/hooks/usePortfolio';

const props = defineProps<{ visible: boolean; stockCode: string; cycleStartId: number | null }>();
const emit = defineEmits<{ close: []; navigateTrade: [stockCode: string]; navigateDividend: [stockCode: string] }>();

interface TxItem { id: number; type: string; trade_date: string; price: string; quantity: string; fee: string; cash_impact: string; }
const txList = ref<TxItem[]>([]);
const stockName = ref('');
const posSummary = ref<{ qty: string; avg: string; pl: number } | null>(null);

async function loadData() {
  if (!props.stockCode) return;
  let sql = 'SELECT * FROM transactions WHERE stock_code = ?';
  const params: any[] = [props.stockCode];
  if (props.cycleStartId) { sql += ' AND id >= ?'; params.push(props.cycleStartId); }
  sql += ' ORDER BY trade_date DESC, created_at DESC';
  txList.value = await selectSql(sql, params) as TxItem[];
  const pos = positionList.value.find(p => p.stock_code === props.stockCode);
  if (pos) { stockName.value = pos.stock_name; posSummary.value = { qty: pos.quantity.toString(), avg: (+pos.avg_price.toString()).toFixed(2), pl: +pos.profit_loss.toString() }; }
  else posSummary.value = null;
}

watch(() => props.visible, (v) => { if (v) loadData(); });

function close() { emit('close'); }
function goTrade() { emit('close'); emit('navigateTrade', props.stockCode); }
function goDividend() { emit('close'); emit('navigateDividend', props.stockCode); }
</script>

<style scoped>
/* Uses global popup styles from uni.scss */
</style>
