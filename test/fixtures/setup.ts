/**
 * 測試環境搭建 — 所有測試文件共享
 */
import { initDatabase, executeSql, selectSql } from '@/utils/db';
import { beforeAll, afterEach } from 'vitest';

beforeAll(async () => {
  await initDatabase();
}, 15000);

afterEach(async () => {
  // Clean data between tests
  await executeSql('DELETE FROM transactions', []);
  await executeSql('DELETE FROM stocks', []);
  await executeSql('DELETE FROM stock_universe', []);
  await executeSql("UPDATE cash_account SET available_cash = '0.00' WHERE id = 1", []);
});

export async function resetDatabase() {
  await executeSql('DELETE FROM transactions', []);
  await executeSql('DELETE FROM stocks', []);
  await executeSql('DELETE FROM stock_universe', []);
  await executeSql("UPDATE cash_account SET available_cash = '0.00' WHERE id = 1", []);
}
