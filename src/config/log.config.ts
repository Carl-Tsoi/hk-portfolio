// 日誌等級配置 — 系統唯一的日誌開關
export const LOG_CONFIG = {
  // H5 開發模式：DEBUG 及以上
  development: ['debug', 'info', 'warn', 'error', 'fatal'] as const,

  // App 生產模式：只記錄 ERROR 和 FATAL
  production: ['error', 'fatal'] as const,

  // vitest 測試模式：WARN 及以上
  test: ['warn', 'error', 'fatal'] as const,

  // 每次啟動清空當天日誌
  clearOnStartup: true,

  // 日誌保留天數
  maxDays: 7,
};

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export function getActiveLogLevels(): readonly string[] {
  // vitest
  if (typeof process !== 'undefined' && (process.env as any)?.VITEST) {
    return LOG_CONFIG.test;
  }
  // H5 瀏覽器
  if (typeof window !== 'undefined' && typeof (globalThis as any).plus === 'undefined') {
    return LOG_CONFIG.development;
  }
  // App Native
  return LOG_CONFIG.production;
}
