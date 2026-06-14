<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { createLogger, Logger } from '@/utils/logger';
import { LOG_CONFIG } from '@/config/log.config';
import { initDatabase } from '@/utils/db';
import IndexPage from '@/pages/index/index.vue';
import HistoryPage from '@/pages/history/history.vue';
import TradePage from '@/pages/trade/trade.vue';
import DividendPage from '@/pages/dividend/dividend.vue';
import AdminPage from '@/pages/admin/admin.vue';

const logger = createLogger('App');
const currentPage = ref('index');
const initError = ref('');
const initDone = ref(false);
// H5 routing
window.addEventListener('navigate', ((e: CustomEvent) => {
  currentPage.value = e.detail.page;
}) as EventListener);

onMounted(async () => {
  // Global error handlers
  window.addEventListener('error', (event) => {
    const msg = `[FATAL] ${event.message} at ${event.filename}:${event.lineno}`;
    logger.fatal('Uncaught error', { message: event.message, filename: event.filename, lineno: event.lineno });
    console.error(msg);
  });
  window.addEventListener('unhandledrejection', (event) => {
    logger.fatal('Unhandled rejection', { reason: String(event.reason) });
    console.error('[FATAL] Unhandled Promise rejection:', event.reason);
  });

  try {
    // Initialize database
    console.log('[App] Initializing database...');
    await initDatabase();
    console.log('[App] Database initialized successfully');

    if (LOG_CONFIG.clearOnStartup) {
      await Logger.clearTodayLog();
    }
    Logger.flush();

    initDone.value = true;
    logger.info('App launched (H5 mode)');
    console.log('[App] Launch complete. Ready.');
  } catch (e: any) {
    const msg = `Database init failed: ${e.message || String(e)}`;
    initError.value = msg;
    logger.fatal('App init failed', { message: String(e), stack: e.stack });
    console.error('[FATAL] ' + msg, e);
  }
});

function switchTab(page: string) {
  currentPage.value = page;
}
</script>

<template>
  <div class="app-shell">
    <!-- Fatal Error Screen -->
    <div v-if="initError" style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;font-family:monospace;">
      <div>
        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
        <div style="font-size:18px;color:#fa4d56;font-weight:bold;margin-bottom:8px;">数据库初始化失败</div>
        <div style="font-size:13px;color:#666;margin-bottom:16px;max-width:300px;word-break:break-all;">{{ initError }}</div>
        <div style="font-size:12px;color:#999;">请检查：<br/>1. 是否已运行 <code>npm run init-db</code><br/>2. 浏览器是否支持 IndexedDB<br/>3. 打开开发者工具查看 Console</div>
        <button onclick="location.reload()" style="margin-top:16px;padding:10px 30px;background:#1e3c72;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;">重试</button>
      </div>
    </div>

    <!-- Loading -->
    <div v-else-if="!initDone" style="display:flex;align-items:center;justify-content:center;height:100%;color:#666;font-size:14px;">
      正在初始化数据库...
    </div>

    <!-- App -->
    <div v-else>
      <div class="page-area">
        <IndexPage v-if="currentPage === 'index'" />
        <HistoryPage v-else-if="currentPage === 'history'" />
        <TradePage v-else-if="currentPage === 'trade'" />
        <DividendPage v-else-if="currentPage === 'dividend'" />
        <AdminPage v-else-if="currentPage === 'admin'" />
      </div>

      <div class="tabbar">
        <div :class="['tabbar-item', currentPage === 'index' ? 'active' : '']" @click="switchTab('index')">
          <span>持仓</span>
        </div>
        <div :class="['tabbar-item', currentPage === 'history' ? 'active' : '']" @click="switchTab('history')">
          <span>流水</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@import '@/uni.scss';

.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 430px;
  margin: 0 auto;
  position: relative;
  background: #f8f9fa;
}

.page-area {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 50px;
}

.tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 430px;
  display: flex;
  background: #fff;
  border-top: 1px solid #eee;
  z-index: 100;
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.tabbar-item {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  font-size: 11px;
  color: #999;
  cursor: pointer;
  user-select: none;
}

.tabbar-item.active {
  color: #1e3c72;
  font-weight: bold;
}
</style>
