<template>
  <div class="page">
    <div class="navbar">
      <button class="back-btn" @click="goBack">← 返回</button>
      <span class="navbar-title">数据管理</span>
      <span style="width:50px"></span>
    </div>

    <!-- 股票列表状态 -->
    <div class="status-card">
      <div class="status-title">📋 股票列表</div>
      <div class="status-detail">已收录：{{ stockCount }} 只股票</div>
      <div class="status-detail">上次同步：{{ lastUpdate || '从未同步' }}</div>
    </div>

    <!-- 步骤1：下载 -->
    <div class="step-card">
      <div class="step-header">
        <span class="step-num">1</span>
        <span class="step-title">下载港交所名单</span>
      </div>
      <div class="step-body">
        <div v-if="fileStatus.exists" class="file-info">
          ✅ 已下载：hkex_list.xlsx（{{ formatSize(fileStatus.size) }}）
          <div class="file-time">保存时间：{{ fileStatus.time }}</div>
        </div>
        <div v-else class="file-info" style="color:#999">
          尚未下载（保存到 downloads/ 目录）
        </div>
        <button class="btn-primary" :disabled="busy" @click="handleDownload">
          <span v-if="busy && busyStep==='download'" class="spinner"></span>
          {{ busy && busyStep==='download' ? '下载中...' : '从港交所下载' }}
        </button>
      </div>
    </div>

    <!-- 步骤2：同步 -->
    <div class="step-card">
      <div class="step-header">
        <span class="step-num">2</span>
        <span class="step-title">同步到系统</span>
      </div>
      <div class="step-body">
        <div v-if="!fileStatus.exists" style="font-size:12px;color:#999;margin-bottom:8px;">
          ⚠️ 请先下载港交所名单
        </div>
        <button class="btn-primary" :disabled="busy || !fileStatus.exists" @click="handleSync"
          :style="!fileStatus.exists ? 'opacity:0.4' : ''">
          <span v-if="busy && busyStep==='sync'" class="spinner"></span>
          {{ busy && busyStep==='sync' ? '同步中...' : '从 downloads/hkex_list.xlsx 同步' }}
        </button>
      </div>
    </div>

    <!-- 查看日志 -->
    <div class="step-card">
      <div class="step-header" @click="showLogs = !showLogs" style="cursor:pointer">
        <span class="step-num">📄</span>
        <span class="step-title">查看日志</span>
        <span style="margin-left:auto;font-size:12px;color:#999;">{{ showLogs ? '收起 ▲' : '展开 ▼' }}</span>
      </div>
      <div v-if="showLogs" class="step-body">
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <button class="btn-small" @click="loadLogs">刷新</button>
          <button class="btn-small" @click="clearLogs" style="background:#fa4d56;color:#fff;border-color:#fa4d56;">清空今日</button>
        </div>
        <div v-if="logContent" class="log-viewer">{{ logContent }}</div>
        <div v-else style="font-size:12px;color:#999;">(暂无日志)</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { selectSql } from '@/utils/db';
import { syncStockListFromHKEX } from '@/services/portfolioService';
import { createLogger } from '@/utils/logger';

const logger = createLogger('admin');
const showLogs = ref(false);
const logContent = ref('');

const stockCount = ref(0);
const lastUpdate = ref('');
const busy = ref(false);
const busyStep = ref('');
const fileStatus = ref<{ exists: boolean; size: number; time: string }>({ exists: false, size: 0, time: '' });

function goBack() {
  window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'index', url: '' } }));
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 KB';
  return bytes > 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB';
}

async function loadStatus() {
  try {
    const rows = await selectSql('SELECT COUNT(*) as c FROM stock_universe', []) as any[];
    stockCount.value = rows[0]?.c || 0;
    const tr = await selectSql('SELECT MAX(applied_at) as t FROM schema_version', []) as any[];
    lastUpdate.value = tr[0]?.t?.slice(0, 16) || '';

    // Check if hkex file exists on disk
    const check = await fetch('/api/check-hkex');
    const info = await check.json();
    if (info.exists) {
      fileStatus.value = {
        exists: true,
        size: info.size,
        time: new Date(info.mtime).toLocaleString('zh-HK'),
      };
    }
  } catch { /* db not ready */ }
}

async function handleDownload() {
  if (busy.value) return;
  busy.value = true;
  busyStep.value = 'download';

  try {
    logger.info('Downloading HKEX xlsx...');
    const resp = await fetch('/api/hkex/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();

    // Save to project directory via API
    const saveResp = await fetch('/api/save-hkex', { method: 'POST', body: buffer });
    const saveResult = await saveResp.json();
    if (!saveResult.ok) throw new Error(saveResult.error);

    fileStatus.value = {
      exists: true,
      size: saveResult.size,
      time: new Date().toLocaleString('zh-HK'),
    };

    logger.info(`HKEX xlsx saved: ${formatSize(saveResult.size)} → downloads/hkex_list.xlsx`);
  } catch (e: any) {
    logger.error('Download failed', { error: String(e) });
  } finally {
    busy.value = false;
    busyStep.value = '';
  }
}

async function handleSync() {
  if (busy.value || !fileStatus.value.exists) return;
  busy.value = true;
  busyStep.value = 'sync';

  try {
    logger.info('Reading xlsx from disk...');
    // Read the saved xlsx file from project directory
    const resp = await fetch('/api/read-hkex');
    if (!resp.ok) throw new Error('文件读取失败');
    const buffer = await resp.arrayBuffer();

    logger.info('Parsing and importing...');
    const count = await syncStockListFromHKEX(buffer);
    lastUpdate.value = new Date().toLocaleString('zh-HK');
    stockCount.value = count;
    logger.info(`Sync complete: ${count} stocks`);
  } catch (e: any) {
    logger.error('Sync failed', { error: String(e) });
  } finally {
    busy.value = false;
    busyStep.value = '';
  }
}

async function loadLogs() {
  try {
    const resp = await fetch('/api/log/read');
    logContent.value = await resp.text();
  } catch { logContent.value = '(无法读取日志)'; }
}

async function clearLogs() {
  const today = new Date().toISOString().slice(0, 10);
  await fetch('/api/log/clear', { method: 'POST', body: JSON.stringify({ date: today }) });
  logContent.value = '';
}

onMounted(() => { loadStatus(); });
</script>

<style scoped>
.page { padding-bottom: 20px; }
.navbar { display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #fff; border-bottom: 1px solid #eee; }
.navbar-title { font-size: 17px; font-weight: 600; }
.back-btn { background: none; border: none; color: #1e3c72; font-size: 15px; cursor: pointer; padding: 4px 8px; }

.step-card { background: #fff; margin: 10px 15px; border-radius: 8px; overflow: hidden; }
.step-header { display: flex; align-items: center; gap: 10px; padding: 12px 15px; background: #f8f9fa; border-bottom: 1px solid #eee; }
.step-num { width: 24px; height: 24px; border-radius: 50%; background: #1e3c72; color: #fff; font-size: 13px; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.step-title { font-size: 15px; font-weight: 600; color: #111; }
.step-body { padding: 12px 15px; }

.file-info { font-size: 13px; color: #333; margin-bottom: 8px; }
.file-time { font-size: 11px; color: #999; margin-top: 2px; }

.btn-primary {
  width: 100%; background: #1e3c72; color: #fff; border: none; border-radius: 6px;
  padding: 10px; font-size: 14px; cursor: pointer;
}
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.spinner {
  display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff; border-radius: 50%; animation: spin 0.6s linear infinite; margin-right: 4px; vertical-align: middle;
}
@keyframes spin { to { transform: rotate(360deg); } }

.status-card { background: #fff; margin: 10px 15px; padding: 14px 15px; border-radius: 8px; }
.status-title { font-size: 16px; font-weight: bold; color: #111; }
.status-detail { font-size: 13px; color: #666; display: block; margin-top: 4px; }

.btn-small {
  padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px;
  background: #fff; font-size: 12px; cursor: pointer;
}
.log-viewer {
  background: #1a1a2e; color: #0f0; font-family: monospace; font-size: 10px;
  padding: 8px; border-radius: 4px; max-height: 300px; overflow-y: auto;
  white-space: pre-wrap; word-break: break-all; line-height: 1.5;
}
</style>
