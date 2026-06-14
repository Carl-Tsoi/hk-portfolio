/**
 * 全局 TypeScript 類型定義
 * 所有模塊的類型真相源
 */
import type Big from 'big.js';

// ===== DB Row Types =====

export interface StockRow {
  stock_code: string;
  stock_name: string;
  current_price: string;
  yesterday_close: string;
  updated_at: string | null;
}

export interface TransactionRow {
  id: number;
  stock_code: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  trade_date: string;
  price: string;
  quantity: string;
  fee: string;
  cash_impact: string;
  remark: string | null;
  created_at: string;
}

export interface CashAccountRow {
  id: number;
  available_cash: string;
  updated_at: string | null;
}

export interface StockUniverseRow {
  stock_code: string;
  stock_name: string;
}

// ===== Business Types =====

export interface TxInput {
  stock_code: string;
  type: 'BUY' | 'SELL' | 'DIVIDEND';
  trade_date: string;
  price: string;
  quantity: string;
  fee: string;
  remark?: string;
}

export interface Position {
  stock_code: string;
  stock_name: string;
  current_price: string;
  yesterday_close: string;
  quantity: Big;
  total_cost: Big;
  avg_price: Big;
  market_value: Big;
  profit_loss: Big;
  profit_loss_pct: string;
  today_profit: Big;
  change_rate: string;
  ratio: string;
}

export interface StockInfo {
  stock_code: string;
  stock_name: string;
}

export interface CalculatePositionsResult {
  positions: Position[];
  cycleMap: Map<string, number>;
}

// ===== State Types =====

export type SortKey = 'market_value' | 'profit_loss' | 'ratio';

// ===== Component Types =====

export interface TxPopupProps {
  visible: boolean;
  stockCode: string;
  cycleStartId: number | null;
}
