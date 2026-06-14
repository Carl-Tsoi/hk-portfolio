<template>
  <div class="page">
    <div class="navbar">
      <span class="navbar-title">流水账本</span>
      <span style="width:50px"></span>
    </div>

    <!-- Filter -->
    <div class="filter-bar">
      <select v-model="filterCode" @change="loadData" style="font-size:14px;padding:4px 8px;border:1px solid #ddd;border-radius:4px;">
        <option value="">全部</option>
        <option v-for="c in filterOptions" :key="c" :value="c.split(' ')[0]">{{ c }}</option>
      </select>
    </div>

    <!-- Empty -->
    <div v-if="groupedList.length === 0" class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无交易记录</div>
      <div class="empty-sub">前往持仓页开始交易</div>
    </div>

    <!-- Groups -->
    <div v-for="group in groupedList" :key="group.key">
      <div class="month-header" @click="toggleGroup(group.key)">
        <span>{{ group.label }}</span>
        <span style="font-size:11px;color:#999">{{ group.items.length }} 笔 {{ collapsed[group.key] ? '▶' : '▼' }}</span>
      </div>

      <div v-if="!collapsed[group.key]">
        <div v-for="tx in group.items" :key="tx.id" class="tx-item" @contextmenu.prevent="onDelete(tx)">
          <span class="tx-date">{{ tx.trade_date.slice(5) }}</span>
          <span class="tx-stock">{{ tx.stock_code }} {{ tx.stock_name }}</span>
          <span :class="['badge', tx.type==='BUY'?'badge-buy':tx.type==='SELL'?'badge-sell':'badge-dividend']">{{ tx.type }}</span>
          <span :class="['tx-qty', tx.type==='SELL'?'text-green':tx.type==='BUY'?'text-red':'']">{{ tx.type==='DIVIDEND' ? '—' : (tx.type==='SELL'?'-':'+')+tx.quantity }}</span>
          <span v-if="+tx.fee>0" class="tx-fee">费 {{ (+tx.fee).toFixed(2) }}</span>
          <span :class="['tx-cash', +tx.cash_impact>=0?'text-green':'text-red']">{{ (+tx.cash_impact>=0?'+':'')+(+tx.cash_impact).toFixed(2) }}</span>
          <button @click.stop="onDelete(tx)" style="background:#fa4d56;color:#fff;border:none;padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer;margin-left:4px;">删</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { selectSql } from '@/utils/db';
import { deleteTransaction } from '@/services/portfolioService';
import { refreshPortfolioData } from '@/hooks/usePortfolio';

const filterCode = ref('');
const filterOptions = ref<string[]>([]);
const collapsed = reactive<Record<string, boolean>>({});

interface TxItem { id: number; stock_code: string; stock_name: string; type: string; trade_date: string; price: string; quantity: string; fee: string; cash_impact: string; }
const groupedList = ref<{ key: string; label: string; items: TxItem[] }[]>([]);

async function loadData() {
  const codes = await selectSql("SELECT DISTINCT t.stock_code, COALESCE(s.stock_name, t.stock_code) as stock_name FROM transactions t LEFT JOIN stocks s ON t.stock_code = s.stock_code ORDER BY t.stock_code", []) as any[];
  filterOptions.value = codes.map((c: any) => `${c.stock_code} ${c.stock_name}`);

  const sql = filterCode.value
    ? 'SELECT t.*, COALESCE(s.stock_name, t.stock_code) as stock_name FROM transactions t LEFT JOIN stocks s ON t.stock_code = s.stock_code WHERE t.stock_code = ? ORDER BY trade_date DESC, created_at DESC'
    : 'SELECT t.*, COALESCE(s.stock_name, t.stock_code) as stock_name FROM transactions t LEFT JOIN stocks s ON t.stock_code = s.stock_code ORDER BY trade_date DESC, created_at DESC';
  const params = filterCode.value ? [filterCode.value] : [];
  const all = await selectSql(sql, params) as TxItem[];

  const map = new Map<string, TxItem[]>();
  for (const tx of all) {
    const m = tx.trade_date.slice(0, 7);
    if (!map.has(m)) map.set(m, []);
    map.get(m)!.push(tx);
  }
  groupedList.value = [...map.entries()].map(([k, v]) => {
    const [y, m] = k.split('-');
    return { key: k, label: `${y}年${parseInt(m)}月`, items: v };
  });
}

function toggleGroup(k: string) { collapsed[k] = !collapsed[k]; }

async function onDelete(tx: TxItem) {
  if (!confirm(`确定要删除 ${tx.stock_code} ${tx.type} 交易吗？这将重新计算持仓成本。`)) return;
  try {
    await deleteTransaction(tx.id);
    await refreshPortfolioData();
    await loadData();
    alert('已删除');
  } catch { alert('删除失败'); }
}

onMounted(() => { loadData(); });
</script>

<style scoped>
.page { padding-bottom: 10px; }
.navbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #fff; border-bottom: 1px solid #eee; }
.navbar-title { font-size: 17px; font-weight: 600; }
</style>
