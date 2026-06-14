# 港股持倉管理系統 — TypeScript 類型定義

> **唯一類型真相源** (Single Source of Truth for Types)。AI 實現所有模塊時，字段名、類型、可選性均以此文件為準，不允許各模塊自行推斷。

---

## 1. 數據庫行類型 (DB Row Types)

對應 `selectSql` 返回的原始行對象。所有金額/數量欄位均為 `string`（TEXT 存儲）。

```typescript
/** stocks 表行 */
interface StockRow {
  stock_code: string;          // PK, 5位等寬, '00700'
  stock_name: string;          // NOT NULL
  current_price: string;       // DEFAULT '0.00'
  yesterday_close: string;     // DEFAULT '0.00'
  updated_at: string | null;   // 'YYYY-MM-DD HH:MM:SS'
}

/** transactions 表行 */
interface TransactionRow {
  id: number;                  // PK AUTOINCREMENT
  stock_code: string;          // FK → stocks
  type: 'BUY' | 'SELL' | 'DIVIDEND';  // CHECK 約束
  trade_date: string;          // 'YYYY-MM-DD'
  price: string;               // 成交單價 | 分紅總額
  quantity: string;            // 絕對值，支援小數（碎股）
  fee: string;                 // DEFAULT '0'
  cash_impact: string;         // NOT NULL
  remark: string | null;
  created_at: string;          // 'YYYY-MM-DD HH:MM:SS'
}

/** cash_account 表行 */
interface CashAccountRow {
  id: number;                  // PK, 全局僅 id=1
  available_cash: string;      // DEFAULT '0.00'，允許負數
  updated_at: string | null;
}

/** stock_universe 表行 */
interface StockUniverseRow {
  stock_code: string;          // PK, 5位等寬
  stock_name: string;          // NOT NULL
}
```

---

## 2. 業務層類型 (Business Layer Types)

`portfolioService.ts` 使用的輸入/輸出類型。計算過程中所有數值使用 `Big` 類型（來自 `big.js`），與 DB 的 `string` 類型明確分離。

```typescript
import Big from 'big.js';

/** addTransaction 輸入（前端表單 → 業務層） */
interface TxInput {
  stock_code: string;          // 5位等寬，已格式化
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  trade_date: string;          // 'YYYY-MM-DD'
  price: string;               // 表單輸入的字串，業務層轉 Big
  quantity: string;            // 表單輸入的字串，絕對值
  fee: string;                 // 可為 '0'
  remark?: string;             // 可選
}

/** calculatePositions 返回的單個持倉 */
interface Position {
  stock_code: string;
  stock_name: string;
  current_price: string;       // Big.toString() → 用於視圖
  yesterday_close: string;
  quantity: Big;               // 持股數量 > 0
  total_cost: Big;             // 除權後持倉總成本（可為負）
  avg_price: Big;              // totalCost ÷ quantity（可為負）

  // 以下為 T4 refreshPortfolioData 計算的派生字段
  market_value: Big;           // currentPrice × quantity
  profit_loss: Big;            // marketValue - totalCost
  profit_loss_pct: string;     // '±XX.XX%'
  today_profit: Big;           // (currentPrice - yesterdayClose) × quantity
  change_rate: string;         // '±XX.XX%'，跟隨現價漲跌方向
  ratio: string;               // 'XX.X%'，佔總市值百分比
}

/** searchStockUniverse 返回 */
interface StockInfo {
  stock_code: string;          // 5位等寬
  stock_name: string;
}

/** addTransaction 返回（供 T4 使用） */
interface AddTransactionResult {
  id: number;                  // 新增流水的自增 ID
  cash_impact: string;         // 現金變動額
}

/** calculatePositions 返回 */
interface CalculatePositionsResult {
  positions: Position[];       // 僅 quantity > 0，市值降序
  cycleMap: Map<string, number>; // stock_code → 當前周期起始 transaction.id
}
```

---

## 3. 狀態層類型 (Hook/Ref Types)

`usePortfolio.ts` 導出的全局 Ref 類型。

```typescript
/** 排序鍵 */
type SortKey = 'market_value' | 'profit_loss' | 'ratio';

/** usePortfolio 導出 */
interface UsePortfolio {
  // 全局 Ref（均為 string，視圖直接綁定）
  totalAsset: Ref<string>;
  totalMarketValue: Ref<string>;
  todayProfit: Ref<string>;
  todayReturnRate: Ref<string>;     // '±XX.XX%'
  totalProfit: Ref<string>;
  totalReturnRate: Ref<string>;     // '±XX.XX%'
  realizedProfit: Ref<string>;
  netInvested: Ref<string>;
  availableCash: Ref<string>;
  lastQuoteUpdateTime: Ref<string>; // 'HH:MM:SS' | ''
  positionList: Ref<Position[]>;
  isLoading: Ref<boolean>;
  cycleMap: Ref<Map<string, number>>;

  // 方法
  refreshPortfolioData: () => Promise<void>;
  refreshMarketQuotes: () => Promise<void>;
  sortPositions: (key: SortKey) => void;
}
```

---

## 4. Yahoo Finance API 響應類型

```typescript
/** v8 chart API 響應（僅定義使用的字段） */
interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        regularMarketPrice: number;
        previousClose: number;
        longName?: string;
        shortName?: string;
      };
    }> | null;
    error: { code: string; description: string } | null;
  };
}
```

---

## 5. 組件 Props / Events 類型

```typescript
/** tx-popup.vue Props */
interface TxPopupProps {
  visible: boolean;
  stockCode: string;
  cycleStartId: number | null;  // 清倉後為 null 的股票不應出現在持倉列表
}

/** tx-popup.vue Events */
interface TxPopupEmits {
  close: [];
  navigateTrade: [stockCode: string];
  navigateDividend: [stockCode: string];
}
```

---

## 6. 類型使用約束 (Type Usage Rules)

| 規則 | 說明 |
|------|------|
| **DB 層** | 所有金額/數量讀寫為 `string`，不得在 DB 層做數學運算 |
| **業務層** | 從 DB 讀取的 string 立即轉為 `Big`；寫入 DB 前 `Big.toString()` |
| **視圖層** | 從 Ref 讀取 string 直接顯示；用戶輸入以 string 傳入業務層 |
| **禁止** | 在任何層使用 `number` 類型處理金額（IEEE 754 精度損失） |
| **禁止** | 在 `Position`、`TxInput` 的數字字段上使用 `number \| string` 聯合類型 |
