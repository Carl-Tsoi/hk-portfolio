# 港股持倉管理系統 — 測試計劃（需求追溯版）

每個測試用例都追溯到 requirement.md 的具體條款。測試層級：**單元 → 集成 → E2E**。

---

## 零、測試基礎設施 (Test Infrastructure)

### 0.1 測試目錄結構

```
uniapp4/
├── src/                          # 源代碼
├── test/
│   ├── unit/                     # 單元測試（純函數，無 DB 依賴）
│   │   ├── formatStockCode.test.ts
│   │   ├── toYahooCode.test.ts
│   │   └── searchStockUniverse.test.ts
│   ├── integration/              # 集成測試（sql.js 內存 DB）
│   │   ├── db.test.ts            # db.ts CRUD + 事務
│   │   ├── portfolioService.test.ts  # 業務邏輯 + DB
│   │   └── usePortfolio.test.ts  # Hook + Service + DB
│   ├── e2e/                      # E2E（暫手動，H5 瀏覽器）
│   ├── fixtures/                 # 測試數據工廠
│   │   ├── stocks.ts
│   │   ├── transactions.ts
│   │   └── setup.ts             # DB 初始化 + 全局 beforeAll/afterAll
│   └── migrations/              # 遷移測試（spec.md §10.7）
│       └── v1_to_v2.test.ts
├── vitest.config.ts
```

### 0.2 測試環境搭建

#### 全局 setup（`test/fixtures/setup.ts`）

```typescript
import { initDatabase, executeSql, selectSql, runInTransaction } from '@/utils/db';
import { beforeAll, afterAll } from 'vitest';

// sql.js 內存模式（vitest 環境自動啟用，見 task.md T2.2）
beforeAll(async () => {
  await initDatabase();  // 創建空 DB（5 張表 + 索引 + cash_account 初始化）
});

afterAll(async () => {
  // sql.js 內存 DB 在測試進程結束時自動釋放，無需手動關閉
});

// 每個測試文件可調用此函數重置 DB 狀態
export async function resetDatabase() {
  await executeSql('DELETE FROM transactions');
  await executeSql('DELETE FROM stocks');
  await executeSql('DELETE FROM stock_universe');  // 保留 schema_version
  await executeSql("UPDATE cash_account SET available_cash = '0.00' WHERE id = 1");
}
```

#### vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',       // sql.js 在 Node.js 中運行
    setupFiles: ['./test/fixtures/setup.ts'],
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/portfolioService.ts', 'src/utils/db.ts', 'src/hooks/usePortfolio.ts'],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

### 0.3 Fixture 工廠函數（`test/fixtures/`）

所有測試數據通過工廠函數創建，禁止在測試用例中直接寫字面量對象。

```typescript
// test/fixtures/transactions.ts
import type { TxInput } from '@/services/portfolioService';

/** 默認買入交易 */
export function createBuyTx(overrides?: Partial<TxInput>): TxInput {
  return {
    stock_code: '00700',
    type: 'BUY',
    trade_date: '2025-06-01',
    price: '320.00',
    quantity: '1000',
    fee: '50.00',
    ...overrides,
  };
}

/** 默認賣出交易 */
export function createSellTx(overrides?: Partial<TxInput>): TxInput {
  return {
    stock_code: '00700',
    type: 'SELL',
    trade_date: '2025-06-15',
    price: '350.00',
    quantity: '500',
    fee: '30.00',
    ...overrides,
  };
}

/** 默認分紅交易 */
export function createDividendTx(overrides?: Partial<TxInput>): TxInput {
  return {
    stock_code: '00700',
    type: 'DIVIDEND',
    trade_date: '2025-06-10',
    price: '5000.00',       // 分紅總額
    quantity: '0',
    fee: '200.00',          // 扣稅
    ...overrides,
  };
}

// test/fixtures/stocks.ts
export function createStockRow(overrides?: Partial<StockRow>): StockRow {
  return {
    stock_code: '00700',
    stock_name: '騰訊控股',
    current_price: '330.00',
    yesterday_close: '320.00',
    updated_at: '2025-06-15 14:30:00',
    ...overrides,
  };
}
```

### 0.4 分層 Mock 策略

| 測試層級 | 被測模塊 | DB 層 | Service 層 | Hook 層 | View 層 |
|----------|----------|:--:|:--:|:--:|:--:|
| **單元** | formatStockCode, toYahooCode, searchStockUniverse | Mock (sql.js 內存) | 直接調用 | — | — |
| **單元** | calculatePositions | 注入假 TransactionRow[] | 直接調用 | — | — |
| **集成** | addTransaction → deleteTransaction | sql.js 內存 | 真實調用 | — | — |
| **集成** | calculatePositions（端到端） | sql.js 內存（先寫入 transactions） | 真實調用 | — | — |
| **集成** | usePortfolio.refreshPortfolioData | sql.js 內存 | 真實調用 | 真實調用 | — |
| **E2E** | 完整用戶流程 | sql.js + IndexedDB | 真實 | 真實 | 真實渲染 |

**關鍵邊界**：
- **單元測試**不 import `db.ts` 的 `executeSql`/`selectSql`。純函數測試（formatStockCode 等）直接傳入字符串；需要 DB 數據的測試（calculatePositions）直接傳入 `TransactionRow[]` 數組。
- **集成測試** import 真實的 `db.ts`（sql.js 內存），通過 `executeSql` 插入數據 → 調用 Service → 驗證 DB 狀態。
- **不對 DB 做 spy/mock**：集成測試直接在 sql.js 內存 DB 上操作。這比 mock 更可靠，且 sql.js 速度足夠快。

### 0.5 測試命名規範

```
describe('[模塊名]', () => {
  describe('[函數名]', () => {
    it('should [預期行為] when [場景]', () => {
      // ...
    });
  });
});
```

示例：
```typescript
describe('portfolioService', () => {
  describe('calculatePositions', () => {
    it('should return empty positions when no transactions exist', async () => { ... });
    it('should calculate weighted average cost after multiple BUYs', async () => { ... });
    it('should reset cost and cycle when quantity reaches zero after SELL', async () => { ... });
    it('should reduce totalCost on DIVIDEND (cost ex-rights)', async () => { ... });
    it('should handle negative average price when totalCost < 0', async () => { ... });
  });
});
```

### 0.6 測試運行命令

```bash
npm test                    # 全部測試（單元 + 集成）
npm test -- --run           # 單次運行（非 watch 模式）
npm test -- test/unit       # 僅單元測試
npm test -- test/integration # 僅集成測試
npm test -- --coverage      # 含覆蓋率報告
```

---

### formatStockCode

| # | 需求條款 | 輸入 | 預期 | 層級 |
|---|---------|------|------|------|
| FMT-01 | 支援純數字 | `"700"` | `"00700"` | 單元 |
| FMT-02 | 自動補全為 5 位 | `"5"` | `"00005"` | 單元 |
| FMT-03 | 自動補全為 5 位 | `"9988"` | `"09988"` | 單元 |
| FMT-04 | 已是 5 位不變 | `"00700"` | `"00700"` | 單元 |
| FMT-05 | 去前後空格 | `" 700 "` | `"00700"` | 單元 |
| FMT-06 | 去非數字字符 | `"700.HK"` | `"00700"` | 單元 |
| FMT-07 | 空字串邊界 | `""` | `""` | 單元 |
| FMT-08 | 全空格邊界 | `"   "` | `""` | 單元 |
| FMT-09 | 全非數字邊界 | `"abc"` | `""` | 單元 |
| FMT-10 | 超 5 位不截斷 | `"123456"` | `"123456"` | 單元 |

### toYahooCode

| # | 需求條款 | 輸入 | 預期 | 層級 |
|---|---------|------|------|------|
| YAH-01 | API 映射 `0700.HK` | `"00700"` | `"0700.HK"` | 單元 |
| YAH-02 | 單數字 | `"00005"` | `"0005.HK"` | 單元 |
| YAH-03 | 4 位代碼 | `"09988"` | `"9988.HK"` | 單元 |

---

## 貳、全市場股票列表與模糊搜索（§2.3）

### stock_universe 初始化

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| UNI-01 | JSON 打包隨 App 發布，首次啟動導入 | 首次啟動，stock_universe 為空（完整版 JSON） | JSON 數據全部導入，~2500+ 條 | 集成 |
| UNI-01a | JSON 打包隨 App 發布，首次啟動導入 | 首次啟動，stock_universe 為空（種子版 JSON） | JSON 數據全部導入，≥ 80 條 | 集成 |
| UNI-02 | 首次啟動導入 | 再次啟動 | COUNT > 0，跳過導入，不重複 | 集成 |
| UNI-03 | — | JSON 文件損壞或為空數組 | 導入失敗不影響其他初始化（cash_account 仍創建）；模糊搜索降級為手動輸入模式 | 集成 |
| UNI-04 | — | 每 500 條一個事務 | 中途失敗不殘留部分數據 | 集成 |

### searchStockUniverse

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| SRH-01 | `LIKE '%keyword%'` 任意位置匹配 | 輸入 `"700"` | 返回包含 00700、01700、87000 等的結果 | 單元 |
| SRH-02 | ≥1 位觸發 | 輸入 `"1"` | 返回所有含 `1` 的代碼 | 單元 |
| SRH-03 | 限前 20 條 | 輸入 `"0"`（極常見） | 只返回前 20 條 | 單元 |
| SRH-04 | 無匹配結果 | 輸入 `"99999"` | 返回空數組 | 單元 |
| SRH-05 | 空輸入 | 輸入 `""` | 返回空數組 | 單元 |
| SRH-06 | 輸入含非數字 | 輸入 `"700.HK"` | 去掉 `.HK` 後匹配 `"700"` | 單元 |
| SRH-07 | 選中後代碼格式化 | 選中 `{code:"00700", name:"騰訊控股"}` | 代碼欄填入 `"00700"`，名稱欄填入 `"騰訊控股"` | 單元 |

### 全市場同步（港交所 xlsx）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| SYN-01 | 從港交所下載並導入 | 用戶點擊「從港交所更新」 | 下載 xlsx → 解析 → 過濾 → TRUNCATE + INSERT ~3,100 條 | 集成 |
| SYN-02 | 下載失敗 | 網絡錯誤 | 保留 stock_universe 現有數據，Toast「更新失敗，請稍後重試」 | 集成 |
| SYN-03 | xlsx 格式異常 | 文件損壞或結構變化 | 保留現有數據，Toast「文件格式異常」 | 集成 |
| SYN-04 | 過濾規則正確 | 導入後檢查 | 無衍生權證、牛熊證、債券；無尾號 8 的人民幣櫃台 | 單元 |
| SYN-05 | 重複導入 | 連續兩次更新 | 第一次導入 ~3,100 條，第二次 TRUNCATE + INSERT 同樣數量（冪等） | 集成 |

---

## 參、持倉均價演算法（§2.4）

### 買入（BUY）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| POS-01 | 總成本 += price×qty+fee | BUY 1000@10, fee=50 | quantity=1000, totalCost=10050, avgPrice=10.05 | 單元 |
| POS-02 | 多次買入加權 | BUY 1000@10,fee=50 → BUY 500@12,fee=30 | quantity=1500, totalCost=16080, avgPrice=10.72 | 單元 |
| POS-03 | 碎股買入 | BUY 123.456@10.50, fee=0 | quantity=123.456, 精度保留 | 單元 |
| POS-04 | 手續費為 0 | BUY 1000@10, fee=0 | totalCost=10000, avgPrice=10.00 | 單元 |
| POS-05 | 零股買入 | BUY qty=0 | 持倉不變 | 單元 |
| POS-06 | 零價買入 | BUY price=0, fee=0, qty=1000 | totalCost=0, avgPrice=0 | 單元 |
| POS-07 | 手續費大於本金 | BUY price=1, qty=10, fee=500 | totalCost=510, avgPrice=51 | 單元 |

### 賣出（SELL）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| POS-08 | 賣出均價不變 | BUY 1000@10,fee=50 → SELL 500@15 | quantity=500, 均價仍為 10.05 | 單元 |
| POS-09 | 均價不變（專項） | BUY 1000@10 → SELL 200@8 → SELL 200@12 → SELL 200@9.5 | 三次賣出後均價恆為 10.05 | 單元 |
| POS-10 | 總成本等比減少 | BUY 1000@10,fee=50(totalCost=10050) → SELL 500 | 新 totalCost = 10.05 × 500 = 5025 | 單元 |
| POS-11 | 碎股賣出 | BUY 1000@10 → SELL 123.456@12 | 剩餘 876.544 股，均價不變 | 單元 |

### 清倉重置（§2.5）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| POS-12 | quantity=0 已清倉 | BUY 1000@10 → SELL 1000 | 股票不在 positionList 中 | 單元 |
| POS-13 | 總成本均價抹平 | BUY 1000@10 → SELL 1000 | 該股在 positionMap 中不存在 | 單元 |
| POS-14 | 清倉後再買，重新開始 | BUY 1000@10 → SELL 1000 → BUY 500@8,fee=30 | quantity=500, totalCost=4030, avgPrice=8.06 | 單元 |
| POS-15 | cycleMap 周期隔離 | 同上 | cycleMap 指向第二次 BUY 的 id，不含第一次 | 單元 |
| POS-16 | 多次清倉再買 | A: BUY→SELL(clr)→BUY→SELL(clr)→BUY | cycleMap 只有最後一次 BUY 的 id | 單元 |

### 分紅除權（§2.6）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| POS-17 | quantity=0，不影響股數 | DIVIDEND price=5000, fee=200 | quantity 不變 | 單元 |
| POS-18 | 成本除權 | BUY 1000@10,fee=50(totalCost=10050) → DIVIDEND 5000/200 | totalCost=10050-4800=5250, avgPrice=5.25 | 單元 |
| POS-19 | 均價可為負 | BUY 1000@10,fee=0 → DIVIDEND 12000/0 | totalCost=-2000, avgPrice=-2.00 | 單元 |
| POS-20 | 扣稅大於總額 | DIVIDEND price=100, fee=150 | 淨額=-50, totalCost 增加 50 | 單元 |
| POS-21 | 連續多次分紅 | BUY → DIVIDEND → DIVIDEND → DIVIDEND | 三次除權累加，總成本每次正確扣減 | 單元 |
| POS-22 | 除權後賣出 | BUY 1000@10 → DIVIDEND 2000/0 → SELL 500@12 | 除權後均價=(10000-2000)/1000=8，賣出後 totalCost=4000 | 單元 |

### 時間線排序（§2.4、db.md §3）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| POS-23 | trade_date ASC, created_at ASC, id ASC | 同日同秒同股：id=1 BUY 100; id=2 SELL 50; id=3 BUY 200 | 按 id 正序遍歷，結果確定且可重現 | 單元 |
| POS-24 | 補錄歷史交易 | BUY trade_date=2020-01-01 → BUY trade_date=2025-06-01 | 先處理 2020 年的，加權均價正確 | 單元 |
| POS-25 | 多股票互不干擾 | A:BUY → B:BUY → A:SELL → B:SELL | A、B 各自獨立計算 | 單元 |
| POS-26 | 全量排序一致性 | 20 筆亂序流水 | 輸出順序與定義一致 | 單元 |

---

## 肆、交易寫入與現金流（§2.6, §4.3, §4.4）

### addTransaction

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| TXN-01 | BUY: cash_impact = -(price×qty + fee) | addTransaction(BUY, 1000, 10, fee=50) | cash_impact = '-10050'，現金減少 | 集成 |
| TXN-02 | SELL: cash_impact = +(price×qty - fee) | addTransaction(SELL, 500, 15, fee=30) | cash_impact = '+7470'，現金增加 | 集成 |
| TXN-03 | DIVIDEND: cash_impact = +(price - fee) | addTransaction(DIVIDEND, price=5000, fee=200) | cash_impact = '+4800'，現金增加 | 集成 |
| TXN-04 | quantity 寫入正確 | DIVIDEND | quantity 寫入 `'0'`（字串） | 集成 |
| TXN-05 | SELL quantity 寫入正確 | SELL 500 | quantity 寫入 `'500'`（絕對值） | 集成 |
| TXN-06 | 新股自動創建 stocks | stocks 表無此代碼 → addTransaction | 事務中先 INSERT stocks，再 INSERT transactions | 集成 |
| TXN-07 | 現金允許負數 | 首次 BUY，cash=0 | 現金變負，不報錯 | 集成 |
| TXN-08 | 事務原子性 | INSERT transactions 成功，UPDATE cash 失敗 | ROLLBACK，流水不殘留，現金不變 | 集成 |
| TXN-09 | 碎股精度 | BUY quantity=123.456 | 所有金額 big.js 計算，TEXT 存儲 | 集成 |

### deleteTransaction

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| TXN-10 | 反向沖抵現金（刪除 BUY） | deleteTransaction(BUY id, cash_impact=-10050) | 現金 +10050 | 集成 |
| TXN-11 | 反向沖抵現金（刪除 DIVIDEND） | deleteTransaction(DIVIDEND id, cash_impact=+4800) | 現金 -4800 | 集成 |
| TXN-12 | 事務原子性 | 現金沖抵失敗 | ROLLBACK，流水保留 | 集成 |
| TXN-13 | 刪除不存在 id | deleteTransaction(99999) | 不報錯，優雅處理 | 集成 |
| TXN-14 | 刪除後現金可為負 | 初始投入階段 | 不報錯 | 集成 |
| TXN-15 | 刪除後 positionList 更新 | 刪除唯一持倉的買入 | 持倉消失 | 集成 |

---

## 伍、對賬等式與財務指標（§2.6, §4.1）

### 核心等式

| # | 需求條款 | 等式 | 場景 | 層級 |
|---|---------|------|------|------|
| REC-01 | 總資產 = 現金 + Σ(現價×持股) | totalAsset == availableCash + Σ(currentPrice × quantity) | 任意狀態 | 集成 |
| REC-02 | 淨投入 = Σ(BUY) - Σ(SELL) - Σ(DIVIDEND_net) | netInvested == ... | 任意狀態 | 集成 |
| REC-03 | 累計盈虧 = 總資產 - 淨投入 | totalProfit == totalAsset - netInvested | 任意狀態 | 集成 |
| REC-04 | 已實現 = 累計 - 未實現 | realizedProfit == totalProfit - unrealizedProfit | 任意狀態 | 集成 |
| REC-05 | 今日盈虧僅 quantity>0 | todayProfit == Σ((current-yesterday)×quantity), quantity>0 only | 有已清倉股票 | 集成 |

### 完整對賬場景

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| REC-06 | 全等式閉合 | BUY A + BUY B + SELL A(部分) + DIV A + 行情刷新 | 五個等式全部成立 | E2E |
| REC-07 | 全等式閉合（清倉後） | BUY A + SELL A(全) + BUY B | 清倉後 A 的已實現計入，未實現為 0 | E2E |
| REC-08 | 全等式閉合（極端） | BUY(大額) + DIVIDEND(大額,均價變負) + SELL(部分) | 負均價時等式仍成立 | E2E |

### 新增財務指標（看板擴展）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| REC-09 | 總市值計算 | 持倉 A:500×10=5000, B:300×20=6000 | totalMarketValue=11000 | 單元 |
| REC-10 | 今日收益率 | todayProfit=1100, totalMarketValue=11000 | todayReturnRate='10.00%' | 單元 |
| REC-11 | 今日收益率除零 | todayProfit=0, totalMarketValue=0 | todayReturnRate='0.00%'，不報錯 | 單元 |
| REC-12 | 累計收益率 | totalProfit=25000, netInvested=100000 | totalReturnRate='25.00%' | 單元 |
| REC-13 | 累計收益率除零 | totalProfit=5000, netInvested=0 | totalReturnRate='0.00%'，不報錯 | 單元 |
| REC-14 | 佔比% | A 市值 5000, 總市值 11000 | A 佔比 '45.5%' | 單元 |
| REC-15 | 漲跌幅% | current=330, yesterday=300 | changeRate='+10.00%' | 單元 |
| REC-16 | 漲跌幅% 除零 | current=330, yesterday=0 | changeRate='0.00%'，不報錯 | 單元 |
| REC-17 | 個股今日盈虧 | 持倉 500 股, current=330, yesterday=300 | todayStockProfit='+15000.00' | 單元 |
| REC-18 | 個股盈虧% | marketValue=165000, totalCost=150000 | stockReturnRate='+10.00%' | 單元 |
| REC-19 | 個股盈虧% 除零 | totalCost=0（零成本） | stockReturnRate='0.00%' | 單元 |
| REC-20 | 行情更新時間記錄 | batchFetchQuotes 成功 | lastQuoteUpdateTime = MAX(stocks.updated_at) 格式化為 HH:MM:SS，非純內存值 | 集成 |
| REC-21 | 行情更新時間持久化 | App 重啟，stocks 表有歷史 updated_at | lastQuoteUpdateTime 從 DB 推導恢復，不丟失 | 集成 |

---

## 陸、行情刷新（§2.7, §4.1）

### batchFetchQuotes

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| QTE-01 | 逐隻請求 + 並發控制 | stocks 有 3 隻股票 | 發 3 次請求（v8 chart API），每次延遲 ≥200ms，最多 3 個並發 | 單元 |
| QTE-02 | 全部成功 | 3 隻都返回 | 所有 stocks 的 current_price、yesterday_close 更新 | 集成 |
| QTE-03 | 部分成功 | 3 隻請求，返回 2 隻 | 2 隻更新，第 3 隻保留舊緩存 | 集成 |
| QTE-04 | 請求失敗 | 網絡超時 | stocks 表數據不變，Toast 提示 | 集成 |
| QTE-05 | 響應格式異常 | 返回 `{chart: {result: null}}` 或無 `meta` 欄位 | 不覆蓋，Toast 提示 | 集成 |
| QTE-06 | stocks 包含已清倉股票 | stocks 有 A(持有) + B(已清倉) | B 的行情也刷新，但不計入今日盈虧 | 集成 |
| QTE-07 | 同時更新 stock_name | 返回含 `longName` 或 `shortName`（v8 chart meta） | 若 stocks.name 為空或過期，同步更新 | 集成 |

### 刷新 UI 交互

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| QTE-08 | stocks 為空 → Toast | 首次啟動，點擊同步行情 | Toast "暫無股票數據，請先錄入交易"，不發請求 | E2E |
| QTE-09 | isLoading 鎖 | 刷新進行中再次點擊 | 第二次被阻止 | E2E |
| QTE-10 | 成功後鎖釋放 | 刷新成功 | 按鈕恢復，可再點擊 | E2E |
| QTE-11 | 失敗後鎖釋放 | 刷新失敗 | 按鈕恢復，可再點擊 | E2E |

---

## 柒、數據庫完整性（§3, db.md）

### DDL 與約束

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| DDL-01 | 建表順序 | initDatabase() | stocks → transactions → cash_account → stock_universe（FK 引用的表先建） | 集成 |
| DDL-02 | IF NOT EXISTS 冪等 | 連續兩次 initDatabase() | 不報錯，表結構不變 | 集成 |
| DDL-03 | type CHECK 約束 | INSERT transactions type='INVALID' | SQLite 拒絕寫入 | 單元 |
| DDL-04 | stock_name NOT NULL | INSERT stocks 不帶 stock_name | SQLite 拒絕寫入 | 單元 |
| DDL-05 | ON DELETE RESTRICT | DELETE FROM stocks WHERE code='00700'（有流水） | SQLite 拒絕刪除 | 單元 |
| DDL-06 | cash_account 單例 | 手動 INSERT 第二條 | 不應發生（代碼保證），若發生系統仍正常 | 集成 |
| DDL-07 | stock_universe 導入後無重複 | 導入完成 | SELECT DISTINCT stock_code 等於總數 | 集成 |
| DDL-08 | 現金初始化 | 首次啟動 | cash_account 有且僅有 id=1, available_cash='0.00' | 集成 |

### 索引有效性

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| IDX-01 | idx_tx_stock_code 加速 | WHERE stock_code='00700' | EXPLAIN QUERY PLAN 顯示 USING INDEX | 集成 |
| IDX-02 | idx_tx_date_created 排序 | ORDER BY trade_date DESC | 使用複合索引反向掃描 | 集成 |
| IDX-03 | idx_universe_code 模糊搜索 | WHERE stock_code LIKE '%700%' | 使用索引 | 集成 |

---

## 捌、頁面功能測試

### 8.1 資產持倉大盤頁（§4.1）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| P01-01 | 看板數據正確 | 有持倉 + 行情 | totalAsset, todayProfit, totalProfit, realizedProfit, netInvested, availableCash 全部顯示 | E2E |
| P01-02 | 預設排序市值降序 | A(市值1000), B(市值5000) | B 排在 A 前面 | E2E |
| P01-03 | 市值相同按代碼升序 | A:00700(市值5000), B:00005(市值5000) | 00005 排在 00700 前面 | E2E |
| P01-04 | 顏色規則：現價≥昨收→紅 | current=330, yesterday=320 | 現價顯示紅色 | E2E |
| P01-05 | 顏色規則：現價<昨收→綠 | current=310, yesterday=320 | 現價顯示綠色 | E2E |
| P01-06 | 顏色規則：市值≥成本→紅 | marketValue=11000, totalCost=10000 | 市值顯示紅色 | E2E |
| P01-07 | 顏色規則：市值<成本→綠 | marketValue=9000, totalCost=10000 | 市值顯示綠色 | E2E |
| P01-08 | 現金為負紅色標註 | availableCash=-50000 | 紅字顯示 | E2E |
| P01-09 | 空狀態 | 無任何持倉 | 看板正常（全 0），持倉列表顯示引導 | E2E |
| P01-10 | 點擊行開彈窗 | 點擊持倉行 | tx-popup 滑出，傳入正確 stockCode 和 cycleStartId | E2E |
| P01-11 | onShow 刷新 | 從 trade 頁返回 | 看板數據更新 | E2E |
| P01-12 | 下拉刷新僅本地 | onPullDownRefresh | 調 refreshPortfolioData，不發網絡請求 | E2E |
| P01-13 | 快捷按鈕跳轉 | 點擊「買賣股票」 | navigateTo trade.vue | E2E |
| P01-14 | 快捷按鈕跳轉 | 點擊「錄入分紅」 | navigateTo dividend.vue | E2E |
| P01-15 | 看板總市值 | 有持倉+行情 | totalMarketValue 正確顯示 | E2E |
| P01-16 | 看板今日收益率 | 有今日盈虧 | 百分比正確，紅綠色跟隨 | E2E |
| P01-17 | 看板累計收益率 | 有累計盈虧 | 百分比正確，紅綠色跟隨 | E2E |
| P01-18 | 看板行情更新時間 | 刷新成功後 | 顯示 HH:MM:SS 格式時間 | E2E |
| P01-19 | 持倉行佔比% | 多隻持倉 | 每行佔比正確，加總約 100% | E2E |
| P01-20 | 持倉行漲跌幅% | 有昨收 | 跟隨現價紅綠，格式 +X.XX% | E2E |
| P01-21 | 持倉行個股今日盈虧 | 有行情 | 每行獨立計算，正負顏色正確 | E2E |
| P01-22 | 持倉行個股盈虧% | 有成本 | 每行獨立計算，紅綠色正確 | E2E |
| P01-23 | 市值格式化：萬 | 市值=330,000 | 顯示「33.0萬」 | E2E |
| P01-24 | 市值格式化：億 | 市值=125,000,000 | 顯示「1.25億」 | E2E |
| P01-25 | 市值格式化：小額 | 市值=8,500 | 顯示「8,500.00」 | E2E |
| P01-26 | 排序切換 | 點擊表頭「盈虧額」 | 列表按盈虧額降序重排 | E2E |
| P01-27 | 排序切換默認 | 點擊表頭「市值」 | 恢復市值降序 | E2E |

### 8.2 全量流水賬本頁（§4.2）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| P02-01 | 排序 trade_date DESC | 有不同日期的流水 | 最新日期在最上面 | E2E |
| P02-02 | 同日按 created_at DESC | 同日多筆 | 最新寫入的在上 | E2E |
| P02-03 | 類型標籤顏色 | BUY 行 | 紅色 badge-buy | E2E |
| P02-04 | 類型標籤顏色 | SELL 行 | 綠色 badge-sell | E2E |
| P02-05 | 類型標籤顏色 | DIVIDEND 行 | 金色 badge-dividend | E2E |
| P02-06 | 數量顯示 | BUY 1000 | 顯示 `+1000` | E2E |
| P02-07 | 數量顯示 | SELL 500 | 顯示 `-500` | E2E |
| P02-08 | 數量顯示 | DIVIDEND | 顯示 `—` | E2E |
| P02-09 | 手續費顯示 | fee>0 | 灰字 "費 XX.XX" | E2E |
| P02-10 | 手續費顯示 | fee=0 | 不顯示 | E2E |
| P02-11 | 備註顯示 | remark 有值 | 行尾灰字顯示 | E2E |
| P02-12 | 備註顯示 | remark 為空 | 不顯示 | E2E |
| P02-13 | picker 篩選全部 | 選中「全部」 | 顯示所有股票流水 | E2E |
| P02-14 | picker 篩選特定 | 選中 00700 | 僅顯示 00700 的流水 | E2E |
| P02-15 | 篩選後切回全部 | 選 00700 → 選全部 | 恢復全量 | E2E |
| P02-16 | 左滑露出刪除按鈕 | 左滑 | 紅色按鈕 120rpx | E2E |
| P02-17 | 點刪除 → 二次確認 | 點刪除 | showModal 彈出 | E2E |
| P02-18 | 取消刪除 | showModal 點取消 | 列表不變 | E2E |
| P02-19 | 確認刪除成功 | 點確認 | Toast「已刪除」→ 列表刷新 | E2E |
| P02-20 | 確認刪除失敗 | 模擬失敗 | Toast「刪除失敗」→ 列表不變 | E2E |
| P02-21 | 刪除後列表為空 | 刪除最後一筆 | 顯示空狀態 | E2E |
| P02-22 | 長按彈 ActionSheet | 長按流水行 | ["刪除", "取消"] | E2E |
| P02-23 | 空狀態 | 無交易 | 顯示引導 | E2E |
| P02-24 | onShow 刷新 | TabBar 切換回來 | 列表更新 | E2E |
| P02-25 | 日期分組顯示 | 跨月份流水 | 每月一個區塊，標題「2025年6月 共N筆」 | E2E |
| P02-26 | 月份分組默認展開 | 打開頁面 | 所有分組展開 | E2E |
| P02-27 | 月份分組點擊折疊 | 點擊月份標題 | 該組流水隱藏，箭頭變 ▶ | E2E |
| P02-28 | 月份分組點擊展開 | 再次點擊 | 該組流水顯示，箭頭變 ▼ | E2E |
| P02-29 | 日期格式 MM-DD | 流水行 | 只顯示月-日，無年份 | E2E |

### 8.3 股票買賣錄入頁（§4.3）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| P03-01 | Tab 切換買入→賣出 | 切換 | 底線變綠，按鈕文案「確認賣出」 | E2E |
| P03-02 | Tab 切換賣出→買入 | 切換 | 底線變紅，按鈕文案「確認買入」 | E2E |
| P03-03 | 切換保留表單 | 填入代碼+數量 → 切 Tab → 切回去 | 內容仍在 | E2E |
| P03-04 | 模糊搜索觸發 | 輸入 `"700"` | 下拉顯示匹配股票 | E2E |
| P03-05 | 選中股票 | 點擊下拉項 | 代碼格式化 + 名稱顯示 | E2E |
| P03-06 | 無匹配提示 | 輸入 `"99999"` | 「無匹配股票，可手動輸入代碼提交」 | E2E |
| P03-07 | 選中後顯示持倉資訊 | 選中有持倉的股票 | 顯示「當前持倉：X 股 \| 持倉均價：XXX.XX」 | E2E |
| P03-08 | 選中無持倉的股票 | 選中 stock_universe 有但從未交易過的 | 不顯示持倉資訊 | E2E |
| P03-09 | 賣出：超持倉阻止 | 持倉 500，輸入賣出 1000 | Toast "賣出數量超過當前持倉（500 股）" | E2E |
| P03-10 | 賣出：等於持倉彈窗確認 | 持倉 500，輸入賣出 500 | showModal 清倉確認 | E2E |
| P03-11 | 清倉確認 → 繼續 | 點「確定繼續」 | 提交成功 | E2E |
| P03-12 | 清倉確認 → 取消 | 點「取消」 | 不提交，留在頁面 | E2E |
| P03-13 | 數量 ≤ 0 | 輸入 0 或負數 | "請輸入有效的交易數量" | E2E |
| P03-14 | 單價 ≤ 0 | 輸入 0 或負數 | "請輸入有效的交易單價" | E2E |
| P03-15 | 日期 > 今天 | 選擇明天 | "交易日期不能晚於今天" | E2E |
| P03-16 | 備註超 200 字 | 輸入 201 字 | 阻止或截斷 | E2E |
| P03-17 | 手續費為空 → 預設 0 | 不填手續費 | 提交成功，fee='0' | E2E |
| P03-18 | 提交中按鈕禁用 | 點提交 | 按鈕變「提交中...」+ disabled，不可再點 | E2E |
| P03-19 | 提交成功 | 校驗通過 | Toast「買入成功」→ refreshPortfolioData → 800ms 後 navigateBack | E2E |
| P03-20 | 提交失敗 | 模擬 addTransaction 失敗 | Toast「提交失敗，請重試」→ 按鈕恢復 | E2E |
| P03-21 | 傳參預填不鎖定 | `?stock_code=00700` | 代碼欄有 00700，可編輯 | E2E |
| P03-22 | 傳參時 Tab 預設買入 | `?stock_code=00700` | Tab 在「買入」 | E2E |
| P03-23 | 返回保護：表單有內容 | 填了代碼，點返回 | showModal「丟棄當前輸入的內容？」 | E2E |
| P03-24 | 返回保護：繼續編輯 | 點「繼續編輯」 | 留在頁面 | E2E |
| P03-25 | 返回保護：丟棄 | 點「丟棄」 | 返回上頁 | E2E |
| P03-26 | 返回保護：表單為空 | 什麼都沒填，點返回 | 直接返回 | E2E |

### 8.4 分紅錄入頁（§4.4）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| P04-01 | 模糊搜索同 trade | 輸入代碼 | 同上 P03-04~P03-08 | E2E |
| P04-02 | 除權即時預覽 | 輸入分紅總額 5000, 扣稅 200 | 卡片顯示淨額 4800, 新均價計算正確 | E2E |
| P04-03 | 除權預覽：均價變負 | 分紅總額 > 總成本 | 均價顯示負數 + 綠色「已完全回本」 | E2E |
| P04-04 | 除權預覽：未選股 | 尚未選中股票 | 不計算預覽 | E2E |
| P04-05 | 分紅總額 ≤ 0 | 輸入 0 | "請輸入有效的分紅總額" | E2E |
| P04-06 | 扣稅 ≥ 分紅總額 | 總額 1000, 扣稅 1000 | "扣稅金額不能超過分紅總額" | E2E |
| P04-07 | 扣稅為空 → 預設 0 | 不填扣稅 | 提交成功 | E2E |
| P04-08 | 日期校驗 | 選明天 | 阻止 | E2E |
| P04-09 | 提交成功 | 校驗通過 | Toast「錄入成功」→ 返回 | E2E |
| P04-10 | 返回保護 | 同 trade | E2E |

### 8.5 個股歷史流水彈窗（§4.5）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| P05-01 | 底部半屏滑出 | 點擊持倉行 | 彈窗從底部動畫滑出 | E2E |
| P05-02 | 頭部顯示代碼+名稱 | 打開 00700 | 等寬大字 00700 + 騰訊控股 | E2E |
| P05-03 | 頭部顯示持倉匯總 | 持有 1000 股，均價 320.50 | 顯示股數和均價 | E2E |
| P05-04 | 頭部成本盈虧（紅） | 市值 > 除權後總成本 | 紅字顯示盈利 | E2E |
| P05-05 | 頭部成本盈虧（綠） | 市值 < 除權後總成本 | 綠字顯示虧損 | E2E |
| P05-06 | 流水列表僅當前周期 | 清倉過再買入 | 只顯示新周期流水，舊的不出現 | E2E |
| P05-07 | 流水倒序 | 有多筆 | 最新在上 | E2E |
| P05-08 | 行內字段 | 每行 | 日期+類型+數量+單價+手續費+現金 | E2E |
| P05-09 | 快捷按鈕去交易 | 點擊 | 關閉彈窗 → navigateTo trade?stock_code=XXXXX | E2E |
| P05-10 | 快捷按鈕錄分紅 | 點擊 | 關閉彈窗 → navigateTo dividend?stock_code=XXXXX | E2E |
| P05-11 | 點遮罩關閉 | 點黑色區域 | 彈窗關閉 | E2E |
| P05-12 | 點 ✕ 關閉 | 點右上角 | 彈窗關閉 | E2E |
| P05-13 | 每次打開重新查詢 | 關閉 → 新增流水 → 再打開 | 顯示最新流水 | E2E |

---

## 玖、跨頁面行為（§4.6）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| X01-01 | 交易提交 → 首頁刷新 | trade 提交成功 → 返回 | 首頁 onShow 觸發刷新，數據一致 | E2E |
| X01-02 | 分紅提交 → 首頁刷新 | dividend 提交成功 → 返回 | 首頁數據一致 | E2E |
| X01-03 | 刪除流水 → 首頁刷新 | history 刪除 → 切回首頁 | 持倉重算，數據一致 | E2E |
| X01-04 | TabBar 切換觸發刷新 | 持倉 ↔ 流水頁 | 各自 onShow 刷新 | E2E |
| X01-05 | 網絡異常不影響本地操作 | 關閉網絡，錄入交易 | 提交成功（本地 SQLite 正常工作） | E2E |
| X01-06 | 網絡異常時刷新行情 | 關閉網絡，點 🔄 | Toast「刷新失敗」，緩存數據不丟 | E2E |
| X01-07 | 刪除後重算持倉 | 刪除一筆買入 | 持倉均價、總成本、現金全部正確重算 | E2E |
| X01-08 | 刪除 + 重建模式 | 刪除錯誤交易 → 重新錄入正確的 | 數據一致（§6.3 設計取捨驗證） | E2E |

---

## 拾、技術品質（§5）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| TQ-01 | big.js 全程精度 | `Big(0.1).plus(0.2)` | `0.3`（非 0.30000000000000004） | 單元 |
| TQ-02 | big.js 乘法 | `Big(10.05).times(1000)` | `10050`（非 10049.999...） | 單元 |
| TQ-03 | big.js 除法 | `Big(100).div(3).times(3)` | 受控精度（big.js 保證） | 單元 |
| TQ-04 | TEXT 存儲精度閉環 | 金額字串寫入 → 讀出 → big.js 計算 | 無精度損失 | 集成 |
| TQ-05 | H5 環境不崩 | 瀏覽器運行 | console.warn 提示，UI 正常渲染 | 集成 |
| TQ-06 | 無原生浮點數混入 | 全局搜索 `Number(` `parseFloat` `parseInt`（用於金額） | 金額路徑無原生 Number | 代碼審計 |

---

## 拾壹、性能（skills.md）

| # | 需求條款 | 場景 | 預期 | 層級 |
|---|---------|------|------|------|
| PERF-01 | 5000 條流水 < 1 秒 | calculatePositions 輸入 5000 條 | 耗時 < 1000ms | 集成 |
| PERF-02 | 現金精度不累積誤差 | 連續 100 筆交易 | 現金餘額無分毫級誤差 | 集成 |

---

## 拾貳、測試覆蓋總覽

| 需求章節 | 測試編號 | 例數 |
|----------|---------|------|
| §2.2 代碼格式化 | FMT-01~10, YAH-01~03 | 13 |
| §2.3 全市場列表 | UNI-01~04, SRH-01~07, SYN-01~03 | 14 |
| §2.4 持倉均價 | POS-01~11 | 11 |
| §2.5 清倉重置 | POS-12~16 | 5 |
| §2.6 分紅除權+新增指標 | POS-17~22, TXN-01~15, REC-01~20 | 41 |
| §2.7 行情刷新 | QTE-01~11 | 11 |
| §3 資料庫 | DDL-01~08, IDX-01~03 | 11 |
| §4.1 首頁 | P01-01~27 | 27 |
| §4.2 流水頁 | P02-01~29 | 29 |
| §4.3 交易頁 | P03-01~26 | 26 |
| §4.4 分紅頁 | P04-01~10 | 10 |
| §4.5 彈窗 | P05-01~13 | 13 |
| §4.6 跨頁面 | X01-01~08 | 8 |
| §5 技術品質 | TQ-01~06 | 6 |
| skills.md 性能 | PERF-01~02 | 2 |
| **總計** | | **227** |

---

## 拾參、執行策略

### 環境

| 階段 | 運行位置 | 數據層 | 工具 |
|------|---------|--------|------|
| 單元測試 | Mac (Node.js) | sql.js (SQLite WASM 內存模式) | vitest |
| 集成測試 | Mac (Node.js) | sql.js (SQLite WASM 內存模式) | vitest |
| E2E 測試 | Mac 瀏覽器 (H5) | sql.js (SQLite WASM + IndexedDB) | 手動 + DevTools |
| 真機驗證 | iPhone 15 Pro Max | plus.sqlite | HBuilder X |

### 第一輪：單元測試（代碼寫完立即跑）

```
npm test
```

- 所有「單元」層級用例（~80 個）
- 環境：vitest + sql.js 內存模式，Node.js 直接執行
- 耗時：< 3 秒（全部用例）
- 目標：portfolioService.ts 覆蓋率 ≥ 95%
- 每次改代碼後重新跑，確保不引入回歸

### 第二輪：集成測試（模塊串聯後跑）

```
npm test -- --run integration
```

- 所有「集成」層級用例（~90 個）
- 環境：vitest + sql.js 內存模式，模擬 DB → Service → Hook 完整鏈路
- 驗證：事務原子性、對賬等式、模塊間數據一致性
- 耗時：< 5 秒

### 第三輪：E2E 手動測試（H5 模式，瀏覽器）

```
npm run dev:h5
# 瀏覽器打開 http://localhost:5173
```

- 所有「E2E」層級用例（~57 個）
- 環境：Mac 瀏覽器 + sql.js (SQLite WASM + IndexedDB 持久化)
- 按頁面逐個操作驗證：看板數據、表單交互、彈窗、刪除流程
- 樣式用瀏覽器 DevTools 調整確認

### 第四輪：真機驗證（iPhone 15 Pro Max）

- plus.sqlite 行為確認：建表、CRUD、事務回滾、性能
- Yahoo Finance API 真實請求 + 響應解析
- UI 在實機 430pt 寬度下的顯示效果
- Touch 交互：左滑刪除、彈窗滑出、鍵盤彈出後佈局

### 不需要測的
- uni-app 框架行為（路由、TabBar、動畫）
- plus.sqlite 原生層（DCloud 的事，僅確認行為符合預期）
- Vue 響應式綁定（Vue 自己的測試）
