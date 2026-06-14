/**
 * Logger — 六級別日誌，H5模式寫入 localStorage，App模式寫入 plus.io
 */
import { getActiveLogLevels, LOG_CONFIG, type LogLevel } from '@/config/log.config';

class Logger {
  private module: string;
  private enabledLevels: Set<LogLevel>;
  static initialized = false;
  static buffer: string[] = [];
  private static STORAGE_KEY = 'hk_portfolio_logs';

  constructor(module: string) {
    this.module = module;
    this.enabledLevels = new Set(getActiveLogLevels() as LogLevel[]);
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.enabledLevels.has(level)) return;

    const now = new Date();
    const timestamp = now.toLocaleString('zh-HK', { hour12: false });
    const ctx = context ? ` | ${JSON.stringify(context)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${this.module}] ${message}${ctx}`;

    // 1. Console — always visible in DevTools + debug panel
    const cfn: Record<string, (...args: unknown[]) => void> = {
      trace: console.debug, debug: console.debug, info: console.info,
      warn: console.warn, error: console.error, fatal: console.error,
    };
    cfn[level](line);

    // 2. Write to disk via POST /api/log (Vite middleware → logs/server-YYYY-MM-DD.log)
    this.writeToDisk(line);

    // 3. localStorage — backup
    this.writeToStorage(line);
  }

  private writeToDisk(line: string): void {
    if (typeof window !== 'undefined' && typeof (globalThis as any).plus === 'undefined') {
      fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      }).catch(() => {}); // Silent — localStorage is the fallback
    }
  }

  private writeToStorage(line: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const key = Logger.STORAGE_KEY + '_' + today;
      const existing = localStorage.getItem(key) || '';
      // Keep max ~500 lines per day
      const lines = (existing ? existing.split('\n') : []).slice(-499);
      lines.push(line);
      localStorage.setItem(key, lines.join('\n'));

      // Cleanup old logs (> maxDays)
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(Logger.STORAGE_KEY)) keys.push(k);
      }
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - LOG_CONFIG.maxDays);
      for (const k of keys) {
        const dateStr = k.replace(Logger.STORAGE_KEY + '_', '');
        if (dateStr < cutoff.toISOString().slice(0, 10)) {
          localStorage.removeItem(k);
        }
      }
    } catch {
      // localStorage full or disabled — silently ignore
    }
  }

  /** Export all logs as downloadable text */
  static exportLogs(): string {
    const allLines: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(Logger.STORAGE_KEY)) {
        const content = localStorage.getItem(k) || '';
        allLines.push(`=== ${k.replace(Logger.STORAGE_KEY + '_', '')} ===`);
        allLines.push(content);
      }
    }
    return allLines.join('\n');
  }

  /** Download logs as a file */
  static downloadLogs(): void {
    const text = Logger.exportLogs();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hk_portfolio_logs_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static flush(): void {
    Logger.initialized = true;
    // Buffer already written to localStorage by each log() call
    Logger.buffer = [];
  }

  static async clearTodayLog(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    const today = new Date().toISOString().slice(0, 10);
    localStorage.removeItem(Logger.STORAGE_KEY + '_' + today);
  }

  trace(msg: string, ctx?: Record<string, unknown>) { this.log('trace', msg, ctx); }
  debug(msg: string, ctx?: Record<string, unknown>) { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.log('error', msg, ctx); }
  fatal(msg: string, ctx?: Record<string, unknown>) { this.log('fatal', msg, ctx); }
}

export function createLogger(module: string): Logger {
  return new Logger(module);
}

export { Logger };
