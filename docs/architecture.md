# 港股持倉管理系統 — 架構與技術規格

> 本文檔定義系統架構、模組邊界、數據庫設計、API 接口和生命週期。

---
## 1. 架構分層與模組職責 (Architectural Layering)

系統在技術實現上分為四個核心層次，AI 必須嚴格遵循各層的職責邊界進行代碼編寫：

**目標平台**：第一版僅支援 5+ App Native 平台（iOS / Android），使用 `plus.sqlite` 進行本地持久化。

**桌面驗證環境**：系統同時提供完整的**桌面瀏覽器運行能力**（H5 模式 + sql.js WASM）。桌面環境與手機環境使用**同一 SQLite 引擎**（sql.js 編譯 SQLite 為 WebAssembly），所有業務邏輯、UI 佈局、數據持久化在桌面上 100% 可驗證。桌面瀏覽器是**主要開發與完整性驗證環境**，僅 plus.sqlite 原生行為（連接池、沙盒路徑）需要真機最終確認。微信小程序不在範圍內（數據庫 API 不相容）。

1. **數據持久層 (`/utils/db.ts`)**：專職負責與 5+ App Native Runtime 的 `plus.sqlite` 進行異步 Promise 橋接，控制數據庫生命週期。所有金額與數量欄位以 TEXT 存儲，與 big.js 形成精度閉環。
2. **業務邏輯層 (`/services/portfolioService.ts`)**：負責將 DDL 實體與業務邏輯（如加權均價、清倉重置、除權）進行融合，並強制導入 `big.js` 確保計算精度。
3. **數據狀態層 (`/hooks/usePortfolio.ts`)**：負責將底層查詢出的靜態數據轉化為 Vue 3 全局響應式狀態（Reactive State），充當本地應用的狀態中心。
4. **視圖展現層 (`/pages/*`)**：負責高信息密度的招商證券風 UI 渲染、用戶輸入校驗、帶參路由跳轉以及個股流水的維護交互。

---


---
## 2. 模組實現要點

### 2.1 模組一：SQLite 資料庫創建與環境降級方案 (`/utils/db.ts`)
**【實現步驟】**：
1. **單例連接維護**：聲明一個全局數據庫連接標記。數據庫名稱固定為 `hk_portfolio_db`，真機沙盒路徑固定為 `_doc/hk_portfolio_db.db`。
2. **雙端運行環境判斷 (Isomorphic Fallback)**：
   - 通過檢查 `typeof plus !== 'undefined'` 且 `plus.sqlite !== undefined` 來確認是否處於 App Native 容器中。
   - **真機步驟**：打開數據庫成功後，必須順序執行建表 DDL 語句（包含 `stocks`, `transactions`, `cash_account` 3張核心表）。
   - **Browser 端步驟**：sql.js（SQLite WASM）提供與 App Native 相同的 SQLite 引擎。持久化流程如下：

```typescript
// db.ts — sql.js 初始化與 IndexedDB 持久化

let db: SQLiteInstance;  // sql.js Database 實例

async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();  // 加載 WASM

  // 1. 嘗試從 IndexedDB 恢復上次的數據庫
  const saved = await loadFromIndexedDB();
  if (saved) {
    db = new SQL.Database(new Uint8Array(saved));
  } else {
    // 2. 嘗試 fetch 種子文件
    try {
      const resp = await fetch('/hk_portfolio_db.db');
      const buf = await resp.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buf));
    } catch {
      // 3. 種子文件也加載失敗 → 創建空白數據庫
      db = new SQL.Database();
    }
  }

  // 4. 執行冪等 DDL（CREATE TABLE IF NOT EXISTS）
  // 5. 執行遷移
  // 6. 初始化 cash_account & stock_universe
}

function autoSave(): void {
  const data = db.export();  // sql.js 導出整個數據庫為 Uint8Array
  const buffer = data.buffer;

  // 寫入 IndexedDB（快速，同步感知）
  saveToIndexedDB(buffer);

  // POST 到 Vite 服務器寫回磁盤（持久化到 .db 文件）
  fetch('/api/save-db', { method: 'POST', body: buffer }).catch(() => {});
}

// IndexedDB 輔助
const DB_NAME = 'hk_portfolio', STORE_NAME = 'state';

async function loadFromIndexedDB(): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE_NAME, 'readonly');
      const getReq = tx.objectStore(STORE_NAME).get('db');
      getReq.onsuccess = () => resolve(getReq.result?.buffer ?? null);
      getReq.onerror = () => resolve(null);
    };
    req.onerror = () => resolve(null);
  });
}

function saveToIndexedDB(buffer: ArrayBuffer): void {
  const req = indexedDB.open(DB_NAME);
  req.onsuccess = () => {
    const tx = req.result.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: 'db', buffer }, 'db');
  };
}
```

   - **IndexedDB 降級**：若 IndexedDB 不可用（如 Safari 私密瀏覽），瀏覽器刷新後數據丟失，恢復為種子文件。Console 輸出警告。
3. **原生回調異步 Promise化**：將 `plus.sqlite.openDatabase`、`executeSql` 和 `selectSql` 的回調完整封裝進標準的 JavaScript `Promise` 中。
4. **可用現金賬戶原子化初始化**：在 `initDatabase()` 的建表腳本成功完成後，必須立刻異步執行一條 `SELECT COUNT(*)` 查詢。若結果為 `0`，則必須插入一條可用現金為 `0` 的初始數據，奠定資金池基石。
5. **全市場股票列表導入（新增）**：建表完畢後，檢查 `stock_universe` 表是否為空。若為空，從打包於 `/src/data/stock_universe.json` 的全市場港股列表（~2500+ 隻）中批量導入。導入採用每 500 條一個事務的批量寫入策略。資料結構為 `{ "stock_code": "00700", "stock_name": "騰訊控股" }`。
6. **市場數據同步按鈕**：在後台管理頁 (admin.vue) 提供「從港交所更新股票列表」按鈕。用戶點擊後，系統下載港交所 xlsx 文件 → 解析 → 過濾 → TRUNCATE + INSERT 覆蓋更新 `stock_universe` 表。此操作與行情刷新獨立，由用戶手動觸發。

### 2.2 模組二：資產記賬服務與新股即時查詢 (`/services/portfolioService.ts`)
**【實現步驟】**：
1. **代碼等寬格式化**：實現 `formatStockCode`，接收輸入去除空格，若長度小於 5 位，必須在前方以字符 '0' 自動補齊（如 `700` -> `00700`）。
2. **新股輸入模糊搜索與入庫 (Local Fuzzy Search)**：
   - 實現 `searchStockUniverse(keyword)` 步驟：在錄入頁面的股票代碼輸入框中，用戶輸入純數字（≥1 位）後，系統即時查詢本地 `stock_universe` 表。
   - 查詢使用 `WHERE stock_code LIKE '%' || ? || '%'` 參數化查詢（任意位置匹配，輸入 `700` 可匹配 `00700`、`01700`、`87000` 等所有含 `700` 的代碼），返回匹配的股票代碼與名稱列表（限前 20 條）。
   - 用戶從下拉列表中選中目標股票後，代碼自動格式化為 5 位等寬字串並填入表單，名稱同步顯示於輸入框下方。
   - 若在 `stock_universe` 中未找到匹配（如新股尚未同步），用戶仍可手動輸入完整代碼並提交。提交時若該股票在 `stocks` 表中不存在，則先執行 `INSERT INTO stocks` 緩存代碼（名稱暫用代碼本身或留空，待後續行情刷新時由 Yahoo Finance 補全），再執行交易流水寫入。
3. **交易寫入與現金流原子化聯動 (`addTransaction`)**：引入 `big.js`，計算 `cash_impact`（買入為負，賣出/分紅為正）。執行流水入庫後，必須立刻執行 `UPDATE cash_account SET available_cash = available_cash + cash_impact`。
4. **全量流水左滑刪除與反向沖抵 (`deleteTransaction`)**：根據 ID 查出該流水的 `cash_impact`。執行反向對沖（可用現金減去 `cash_impact`），對沖成功後物理刪除該紀錄。
5. **複式記賬持倉與均價重算算法 (`calculatePositions`)**：異步讀取 `transactions` 全量表，必須嚴格按 `trade_date ASC, created_at ASC, id ASC` 正序排列遍歷。（`id` 作為最終 tiebreaker：確保同一秒內寫入的同股票多筆交易有確定性排序，防止因 `created_at` 精度僅到秒而導致的順序不穩定。）
   - `BUY`：當前股數加上買入股數；總成本加上 `(買入單價 * 數量 + 手續費)`。
   - `SELL`：先算出賣出前的持倉均價。當前股數減去賣出股數。若股數歸零（清倉重置），必須將該股票的持倉總成本與均價強制重置為 0；未清倉則新總成本 = 賣出前持倉均價 * 殘餘股數。
   - `DIVIDEND`：股數不變。**字段語義**：DIVIDEND 交易中 `price` 存儲**分紅總額**（非 0），`fee` 存儲**扣稅/手續費**。分紅淨額 = price - fee。將分紅淨額從該股票目前的持倉總成本中扣除（成本除權策略），同時分紅淨額計入可用現金（現金增加）。
	   - **清倉周期隔離**：`calculatePositions()` 遍歷時額外維護一個 `positionCycleMap`（`Map<string, number>`），記錄每隻股票當前持倉周期的起始 `transaction.id`。當某股票因賣出導致股數歸零時，重置其周期記錄；若之後再次買入，則將新的第一筆 BUY 的 `id` 記錄為新周期起始點。此映射提供給 tx-popup 查詢使用（`WHERE id >= cycleStartId`），確保彈窗僅展示當前周期的流水，歷史清倉前的舊流水不顯示。

### 2.3 模組三：全局狀態同步中心與批量行情網路優化 (`/hooks/usePortfolio.ts`)
**【實現步驟】**：
1. **全局狀態單例化**：在模組頂部（函數外部）定義全局響應式變數 `totalAsset`, `todayProfit`, `totalProfit`, `availableCash`, `positionList`，確保不同頁面共享同一份內存狀態。
2. **手動刷新行情**：
   - **🔄 同步行情**：點擊後從 Yahoo Finance v8 逐隻拉取 `stocks` 表中所有股票的現價與昨收價，批量 UPDATE 刷新本地緩存，隨後自動觸發 `refreshPortfolioData()` 重算所有指標。無需單獨的「重算」按鈕（每次數據變更後系統自動重算）。
   - **下拉刷新**：手勢下拉觸發 `refreshPortfolioData()`（僅本地計算，不發網路請求），`uni.stopPullDownRefresh()` 停止動畫。
   - **⚠️ 2026-06 更新**：原 v7 批量端點已下線（401）。實際使用 v8 逐隻請求，tasks.md T3 `batchFetchQuotes` 為最終執行標準。
   - **並發防抖保護**：行情刷新與交易提交必須設置 `isLoading` 布爾鎖。在刷新進行中時，刷新按鈕必須視覺禁用（灰色 + 旋轉動畫），且禁止重複觸發。交易提交按鈕同理，防止重複入庫。
   - **API 降級策略**：若 Yahoo Finance 請求失敗（網路超時、HTTP 錯誤、返回格式異常），系統必須：(a) 保留 stocks 表中上一次成功緩存的價格數據不做覆蓋；(b) 通過 `uni.showToast` 提示用戶「刷新失敗，請檢查網絡」；(c) 不阻塞其他本地功能的正常使用（持倉計算、交易錄入等仍可基於緩存數據運行）。
3. **數據流向與財務指標重算 (`refreshPortfolioData`)**：從資料庫取得最新現金。呼叫 `calculatePositions()` 取得最新持倉明細，基於 `big.js` 高精度累加計算總資產、累計盈虧、已實現盈虧、淨投入與今日盈虧，動態驅動前端視圖刷新。
   - **總資產公式**：$$\text{totalAsset} = \text{availableCash} + \sum(\text{current\_price} \times \text{quantity})$$
   - **淨投入公式**：$$\text{netInvested} = \sum(\text{BUY: price} \times \text{quantity} + \text{fee}) - \sum(\text{SELL: price} \times \text{quantity} - \text{fee}) - \sum(\text{DIVIDEND: price} - \text{fee})$$
   - **累計盈虧公式**：$$\text{totalProfit} = \text{totalAsset} - \text{netInvested}$$（即已實現 + 未實現的整體盈虧）
	   - **已實現盈虧**（新增）：採用總量減法，不追溯歷史。$$\text{realizedProfit} = \text{totalProfit} - \text{unrealizedProfit}$$ 其中未實現盈虧 = $$\sum_{\text{quantity} > 0}(\text{current_price} \times \text{quantity} - \text{總成本})$$ 數學閉環：累計盈虧涵蓋全部盈虧（已實現 + 未實現），減去當前持倉的未實現部分即為已落袋的利潤。無需回溯每筆清倉，算法簡潔。
   - **今日盈虧**：僅對 `quantity > 0` 的持倉計算 `(current_price - yesterday_close) * quantity` 並累加。已清倉股票雖行情被刷新緩存，但其今日盈虧不計入大盤看板。


### 2.4 模組四：數據獲取接口規範

#### 2.4.1 批量行情查詢（Yahoo Finance v8）

用於刷新用戶持倉股票的當前市價和昨日收盤價。

- **端點**：`https://query1.finance.yahoo.com/v8/finance/chart/{code}?interval=1d&range=1d`
- **代碼映射**：`00700` → `0700.HK`（去掉一個前導零，追加 `.HK`）
- **請求策略**：逐隻請求，每 200ms 一個，最大並發 3（v7 批量端點已下線）
- **響應解析**：`chart.result[0].meta` → `regularMarketPrice`（現價）、`previousClose`（昨收）、`longName`（名稱）
- **降級**：請求失敗時保留 stocks 表緩存數據，Toast 提示用戶

#### 2.4.2 全市場股票列表（港交所官方文件）

用於更新 `stock_universe` 表（模糊搜索的主數據源）。**不再使用 Yahoo Finance**。

- **數據源**：港交所官方證券名單
  - URL：`https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx`
  - 格式：`.xlsx`（Excel），約 1.4MB，每日更新
  - 內容：~17,800 條記錄，含代碼、中文名稱、分類、次分類
- **過濾規則**：只保留以下分類（排除衍生權證、牛熊證、債券、股本權證）：
  - 股本（主板 + 創業板）
  - 交易所買賣產品（ETF + 槓桿反向產品）
  - 房地產投資信託基金（REIT）

---
## 3. 數據獲取接口

用於刷新用戶持倉股票的當前市價和昨日收盤價。

- **端點**：`https://query1.finance.yahoo.com/v8/finance/chart/{code}?interval=1d&range=1d`
- **代碼映射**：`00700` → `0700.HK`（去掉一個前導零，追加 `.HK`）
- **請求策略**：逐隻請求，每 200ms 一個，最大並發 3（v7 批量端點已下線）
- **響應解析**：`chart.result[0].meta` → `regularMarketPrice`（現價）、`previousClose`（昨收）、`longName`（名稱）
- **降級**：請求失敗時保留 stocks 表緩存數據，Toast 提示用戶

#### 2.4.2 全市場股票列表（港交所官方文件）

用於更新 `stock_universe` 表（模糊搜索的主數據源）。**不再使用 Yahoo Finance**。

- **數據源**：港交所官方證券名單
  - URL：`https://www.hkex.com.hk/chi/services/trading/securities/securitieslists/ListOfSecurities_c.xlsx`
  - 格式：`.xlsx`（Excel），約 1.4MB，每日更新
  - 內容：~17,800 條記錄，含代碼、中文名稱、分類、次分類
- **過濾規則**：只保留以下分類（排除衍生權證、牛熊證、債券、股本權證）：
  - 股本（主板 + 創業板）
  - 交易所買賣產品（ETF + 槓桿反向產品）
  - 房地產投資信託基金（REIT）
  - **排除**人民幣櫃台（代碼尾號為 `8` 的 R 類股票）
  - 過濾後約 **3,100 條**
- **解析庫**：SheetJS (`xlsx` npm 包)，在 App 內懶加載（僅後台管理頁使用，不影響主流程體積）
- **更新機制**：用戶手動點擊「從港交所更新股票列表」按鈕觸發（詳見 T10 後台管理頁）
- **降級**：下載或解析失敗時保留 `stock_universe` 現有數據不變，Toast 提示用戶

#### 2.4.3 種子文件生成（開發用）

桌面開發階段使用 Node.js 腳本預生成種子數據庫，與 App 內更新使用**同一套過濾邏輯**。

- **腳本**：`scripts/download-hkex.mjs`
- **流程**：下載 xlsx → SheetJS 解析 → 過濾 → 輸出 `src/data/stock_universe.json` + 導入 `public/hk_portfolio_db.db`
- **觸發**：`node scripts/download-hkex.mjs`（開發者手動執行，或 `npm run init-db` 時自動調用）
---

## 4. 數據庫架構

# 港股本地持倉管理系統 - 資料庫架構與實體生成規範 (Database Topology Specification)

本文件定義了系統本地 SQLite 數據庫的實體關係、嚴格的欄位約束（Constraints）以及性能優化索引策略，專門用作 AI 自動化編碼與 DDL 腳本生成的最高結構上下文（Context）。

---

### 4.1 資料庫拓撲結構與關係

系統由四張核心本地數據表構成複式記賬的封閉循環。AI 在設計創表語句時，必須嚴格維持以下實體關聯：

1. **`stock_universe` (全市場股票列表)**：作為全市場港股代碼與名稱的主數據字典表，用於模糊搜索輸入提示。
2. **`stocks` (股票行情緩存表)**：存放用戶交易過的股票的行情緩存。
3. **`transactions` (交易流水賬本表)**：作為核心業務流水表，其股票代碼欄位**必須強關聯**至 `stocks` 表的主鍵。
4. **`cash_account` (賬戶可用現金表)**：作為全局單例資金池，記錄全系統的本地滾動剩餘現金。

---

### 4.2 數據表結構設計與嚴格約束目標

AI 建立的三張數據表必須完全滿足以下底層約束邊界，從源頭確保單機數據的完整性：

### 2.1 股票行情緩存實體 (`stocks`)
* **主鍵約束**：股票代碼（`stock_code`）為唯一主鍵，類型為 `TEXT`，嚴格限制存儲 5 位等寬格式化後的純數字字串。
* **空值約束**：股票名稱（`stock_name`）為必填欄位（`NOT NULL`），不允許因網絡未響應而寫入空字串。
* **高精度數值約束**：最新市價（`current_price`）與昨日收盤價（`yesterday_close`）類型為 `TEXT`，預設值為 `'0.00'`。**金額欄位強制使用 TEXT 而非 REAL**，以避免 IEEE 754 浮點數精度損失，與業務層 `big.js` 高精度運算閉環。讀寫時由應用層以字串形式序列化/反序列化。
* **時間審計**：更新時間（`updated_at`）紀錄最後一次行情寫入的時間戳。

### 2.2 交易流水賬本實體 (`transactions`)
* **主鍵約束**：流水 ID（`id`）為自增主鍵（`INTEGER PRIMARY KEY AUTOINCREMENT`）。
* **外鍵約束**：股票代碼（`stock_code`）必須作為外鍵（`FOREIGN KEY`）強關聯至 `stocks(stock_code)`。**級聯策略**設定為：當字典表個股刪除時，限制其流水被物理刪除（`ON DELETE RESTRICT`）。
* **列舉約束 (Check Constraint)**：交易類型（`type`）必須設置檢查約束，限制寫入值只能為 `BUY`（買入）、`SELL`（賣出）或 `DIVIDEND`（分紅）三者之一。
* **高精度數值欄位**：交易單價（`price`）、交易數量（`quantity`）、手續費（`fee`）與現金變動額（`cash_impact`）全部採用 `TEXT` 類型存儲，預設值為 `'0'`。其中 `quantity` 支援小數（兼容港股碎股 Odd Lot 交易）。金額欄位選用 TEXT 的理由同 §2.1，確保與 `big.js` 精度閉環。
* **時間線審計**：交易日期（`trade_date`，格式 YYYY-MM-DD）與系統寫入時間（`created_at`，格式 YYYY-MM-DD HH:MM:SS）均為必填欄位，用作全量賬本的排序基石。

### 2.4 全市場股票列表實體 (`stock_universe`)
* **主鍵約束**：股票代碼（`stock_code`）為唯一主鍵，類型為 `TEXT`，嚴格限制存儲 5 位等寬格式化後的純數字字串。
* **空值約束**：股票名稱（`stock_name`）為必填欄位（`NOT NULL`）。
* **數據來源**：以 JSON 文件打包隨 App 發布（~2500+ 隻港股），首次啟動時自動導入。用戶可通過「同步市場數據」按鈕從 Yahoo Finance 拉取最新列表並覆蓋更新。
* **用途**：為交易錄入頁和分紅錄入頁的模糊搜索輸入框提供本地即時提示（LIKE 前綴匹配），無需依賴網路。
* **與 `stocks` 表的職責分離**：`stock_universe` 存全市場代碼+名稱（主數據），`stocks` 僅存用戶交易過的股票+行情緩存（業務數據）。兩者互不冗餘。
* **主鍵約束**：自增主鍵（`id`）。
* **單例數值約束**：可用現金（`available_cash`）預設值為 `'0.00'`，類型為 `TEXT`（高精度原因同 §2.1、§2.2）。由於系統不設初始充值功能，此欄位在業務邏輯上**允許為負數**（代表初始投入本金）。
* **數據庫基石守護**：此表在全局有且僅能存在 `id = 1` 的一條紀錄。

---

### 4.3 單機性能優化與索引策略

為了確保應用在本地累積數千條流水後，多頁面與個股歷史彈窗的加載依然能達到 0 毫秒級的閃電響應，AI 必須在數據庫初始化時，自動創建以下高效率索引：

1. **個股流水檢索索引**：
   - 在 `transactions` 表的 `stock_code` 欄位上建立非唯一索引。
   - **優化目標**：極速提升「個股歷史流水彈窗」過濾單隻股票所有流水的查詢速度。
2. **全量總賬本時間線索引**：
   - 在 `transactions` 表上建立複合索引：`(trade_date ASC, created_at ASC)`。
   - **優化目標**：升序索引同時服務兩個核心查詢模式：(a) 持倉重算（`calculatePositions`）的正時序遍歷（ASC），(b) 全量流水賬本頁面的倒序展示（DESC）— SQLite 可反向掃描升序索引實現降序輸出，無需額外排序開銷。
3. **全市場股票檢索索引**：
   - 在 `stock_universe` 表的 `stock_code` 欄位上建立非唯一索引。
   - **優化目標**：加速模糊搜索輸入框的 `LIKE` 前綴匹配查詢（如 `WHERE stock_code LIKE '700%'`）。
---
## 5. 數據庫遷移策略


系統使用 `schema_version` 表追蹤當前數據庫的 schema 版本。

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL  -- 遷移執行時間 'YYYY-MM-DD HH:MM:SS'
);
```

**版本號規則**：從 `1` 開始，每次 schema 變更遞增 `+1`。版本號對應 `manifest.json` 中的應用版本號**無關**——它僅追蹤數據庫結構變更，不追蹤應用版本。

### 10.2 遷移執行流程

`initDatabase()` 中的執行順序：

```
1. CREATE TABLE IF NOT EXISTS（當前版本的所有表 — 冪等）
   包括 schema_version 表本身

2. CREATE INDEX IF NOT EXISTS（當前版本的所有索引 — 冪等）

3. SELECT MAX(version) FROM schema_version → 獲取當前 DB 版本

4. 若 version < TARGET_VERSION：
   BEGIN TRANSACTION
     for v = currentVersion + 1 to TARGET_VERSION:
       執行 migrate_v{v-1}_to_v{v}()
       INSERT INTO schema_version VALUES (v, NOW())
   COMMIT
   若失敗 → ROLLBACK → throw Error（阻止 App 啟動）

5. 若 version == TARGET_VERSION：
   跳過遷移，執行正常的初始化操作（T2.3 現金賬戶、T2.4 stock_universe）
```

### 10.3 當前版本定義

```typescript
/** 當前代碼期望的 schema 版本 */
const TARGET_SCHEMA_VERSION = 1;

/** 遷移註冊表：version N → version N+1 的遷移函數 */
const MIGRATIONS: Record<number, () => Promise<void>> = {
  // 暫無遷移（v1 為初始版本）
  // 1: migrateV1ToV2,  ← 未來新增時取消註釋並實現
};
```

### 10.4 v1 初始 Schema（基準版本）

v1 即為 tasks.md T2.1 定義的完整 DDL：

| 表 | 說明 |
|----|------|
| `stocks` | 股票行情緩存表 |
| `transactions` | 交易流水賬本表 |
| `cash_account` | 賬戶可用現金表 |
| `stock_universe` | 全市場股票列表 |
| `schema_version` | **新增** — 版本追蹤 |

v1 的 `initDatabase()` 在執行完 DDL 後，自動寫入 `INSERT INTO schema_version VALUES (1, datetime('now','localtime'))`。

### 10.5 遷移示例：v1 → v2（未來參考）

假設 v2 需要在 `transactions` 表新增 `settlement_date` 字段：

```typescript
async function migrateV1ToV2(): Promise<void> {
  // 1. 新增字段（SQLite 不支持 ADD COLUMN IF NOT EXISTS，需手動檢查）
  const cols = await selectSql("PRAGMA table_info('transactions')");
  if (!cols.some((c: any) => c.name === 'settlement_date')) {
    await executeSql(
      "ALTER TABLE transactions ADD COLUMN settlement_date TEXT"
    );
  }

  // 2. 新增索引
  await executeSql(
    "CREATE INDEX IF NOT EXISTS idx_tx_settlement ON transactions(settlement_date)"
  );

  // 3. 更新現有數據（可選）
  // await executeSql("UPDATE transactions SET settlement_date = trade_date WHERE settlement_date IS NULL");
}
```

### 10.6 遷移規範

| 規則 | 說明 |
|------|------|
| **冪等** | 所有遷移函數必須可重複執行不報錯（使用 `IF NOT EXISTS`、`PRAGMA table_info` 檢查） |
| **事務包裹** | 每個遷移步驟在獨立的 `BEGIN/COMMIT` 中執行 |
| **不可逆** | 遷移只向前（不支援降級到舊版本） |
| **先建表後遷移** | `CREATE TABLE IF NOT EXISTS` 在遷移前執行（確保新安裝用戶直接得到最新 schema） |
| **遷移失敗則阻止啟動** | 遷移中的任何錯誤都會 throw → `initDatabase()` reject → `onLaunch` 顯示錯誤頁面 |
| **測試覆蓋** | 每個遷移函數必須有對應的測試：創建舊版本 DB → 執行遷移 → 驗證新 schema |

### 10.7 遷移測試模板

```typescript
// test/migrations/v1_to_v2.test.ts
import { describe, it, expect } from 'vitest';

describe('migration v1 → v2', () => {
  it('should add settlement_date column', async () => {
    // 1. 創建 v1 schema
    await initDatabaseV1();  // 僅執行 v1 DDL

    // 2. 插入測試數據
    await executeSql("INSERT INTO stocks VALUES ('00700', '騰訊', '320', '315', '2025-01-01')");
    await executeSql("INSERT INTO transactions VALUES (1, '00700', 'BUY', '2025-01-01', '320', '100', '10', '-32010', NULL, '2025-01-01 10:00:00')");

    // 3. 執行遷移
    await migrateV1ToV2();

    // 4. 驗證新字段存在且有默認值
    const cols = await selectSql("PRAGMA table_info('transactions')");
    expect(cols.some((c: any) => c.name === 'settlement_date')).toBe(true);

    // 5. 驗證舊數據完整
    const tx = await selectSql("SELECT * FROM transactions WHERE id = 1");
    expect(tx[0].stock_code).toBe('00700');
    expect(tx[0].quantity).toBe('100');
  });
});
```

### 10.8 App 啟動時的錯誤處理

若遷移失敗（例如用戶手動修改了數據庫文件導致 schema 不一致），系統應：

1. **顯示錯誤頁面**（非白屏崩潰）：
   ```
   數據庫升級失敗
   請聯繫技術支援
   [錯誤碼：MIGRATION_FAILED_1→2]
   ```
2. **記錄完整錯誤日誌**（含原始錯誤 stack）
3. **不刪除用戶數據**（保留問題現場供排查）
4. **不允許繼續使用**（防止數據損壞擴大）

在 `App.vue` 的 `onLaunch` 中：
```typescript
try {
  await db.initDatabase();
} catch (e) {
  // 遷移失敗 → 設置全局錯誤狀態
  migrationError.value = {
    title: '數據庫升級失敗',
    message: '請重新安裝 App 或聯繫支援',
    error: e,
  };
  // 阻止進入首頁（顯示錯誤頁面）
}
```

---

## 6. 生命週期與數據流


### 12.1 場景一：App 冷啟動

```
┌─ App.vue onLaunch ─────────────────────────────────────────────┐
│                                                                  │
│  db.initDatabase()                                               │
│    ├─ CREATE TABLE IF NOT EXISTS (5 張表)                        │
│    ├─ CREATE INDEX IF NOT EXISTS (3 個索引)                      │
│    ├─ SELECT MAX(version) FROM schema_version                    │
│    ├─ 若需遷移 → 執行遷移鏈                                       │
│    ├─ 初始化 cash_account (id=1, 若不存在)                        │
│    ├─ 初始化 stock_universe (從 JSON 導入, 若為空)                │
│    └─ resolve() ─────────────────────────────────────────────┐   │
│                                                               │   │
│  ⏸️ 阻塞：等待 initDatabase() 完成                               │   │
│                                                               │   │
└───────────────────────────────────────────────────────────────┘   │
                                                                    │
┌─ pages/index/index.vue onShow ───────────────────────────────┐   │
│  refreshPortfolioData()                                       │   │
│    ├─ SELECT available_cash FROM cash_account                 │   │
│    ├─ calculatePositions()                                    │   │
│    │    ├─ SELECT * FROM transactions ORDER BY trade_date,     │   │
│    │    │  created_at, id ASC                                 │   │
│    │    └─ 遍歷計算所有 position + cycleMap                    │   │
│    ├─ SELECT MAX(updated_at) FROM stocks → lastQuoteUpdateTime│   │
│    ├─ 計算 totalAsset, todayProfit, totalProfit,              │   │
│    │  realizedProfit, netInvested, totalMarketValue           │   │
│    ├─ 計算每個持倉的佔比/漲跌幅/今盈/盈虧%                      │   │
│    └─ 更新全局 Ref → Vue 響應式 → 視圖渲染                     │   │
│                                                               │   │
│  📱 首屏渲染完成（用戶看到看板+持倉列表）                         │   │
│                                                               │   │
└───────────────────────────────────────────────────────────────┘<──┘
```

**關鍵規則**：
- `App.vue onLaunch` 中 `initDatabase()` 是**阻塞**的（await），未完成前不掛載頁面
- `pages/index onShow` 在 `onLaunch` 之後觸發（uni-app 保證）
- `refreshPortfolioData()` 在 `onShow` 中是**非阻塞**的（await 但不阻塞渲染，數據到達後響應式更新）

### 12.2 場景二：交易提交 → 返回首頁

```
┌─ trade.vue ──────────────────────────────────────────┐
│  handleSubmit()                                       │
│    ├─ 1. validateForm() — L1 格式校驗                  │
│    ├─ 2. 檢查 isLoading 鎖                            │
│    ├─ 3. isLoading = true → 按鈕 disabled             │
│    ├─ 4. addTransaction(tx) ──────────────────────┐   │
│    │    ├─ SELECT current holdings (for SELL check)│   │
│    │    ├─ L2 業務校驗（賣出≤持倉等）               │   │
│    │    ├─ BEGIN TRANSACTION                       │   │
│    │    ├─ INSERT INTO transactions                │   │
│    │    ├─ UPDATE cash_account                     │   │
│    │    ├─ COMMIT                                  │   │
│    │    └─ return { id, cash_impact }              │   │
│    ├─ 5. refreshPortfolioData() ──────────────────┘   │
│    ├─ 6. uni.showToast('買入成功')                     │
│    ├─ 7. setTimeout 800ms                              │
│    └─ 8. uni.navigateBack()                            │
│         │                                              │
│         ▼                                              │
│  trade.vue 銷毀                                        │
└────────────────────────────────────────────────────────┘

┌─ index.vue onShow ───────────────────────────────────┐
│  refreshPortfolioData()  ← 再次執行                    │
│    └─ 全局 Ref 更新 → 看板 + 列表刷新                   │
│  📱 用戶看到更新的持倉數據                              │
└────────────────────────────────────────────────────────┘
```

**關鍵規則**：
- `addTransaction` 返回前**必須先調用 `refreshPortfolioData()`**（步驟 5），確保全局 Ref 在返回前已更新
- `navigateBack` 後 `index.vue onShow` **再次**觸發 `refreshPortfolioData()`（雙重保障）
- 800ms 延遲用於確保 Toast 可見（用戶感知回饋），期間 `isLoading` 保持 true

### 12.3 場景三：彈窗打開/關閉

```
┌─ index.vue ──────────────────────────────────────────┐
│  用戶點擊持倉行                                         │
│    ├─ 從 positionList 取 cycleStartId                  │
│    ├─ showPopup = true（或直接傳入 props）              │
│    └─ <tx-popup :visible="true" :stock-code="00700"    │
│         :cycle-start-id="42" />                        │
└────────────────────────────────────────────────────────┘
         │
         ▼
┌─ tx-popup.vue ───────────────────────────────────────┐
│  watch(visible) → true:                               │
│    ├─ 1. SELECT * FROM transactions                   │
│    │    WHERE stock_code = '00700' AND id >= 42       │
│    │    ORDER BY trade_date DESC, created_at DESC      │
│    ├─ 2. 從 positionList 取出該股票匯總信息              │
│    └─ 3. 渲染頭部 + 流水列表                            │
│                                                       │
│  用戶點擊「去交易」:                                     │
│    ├─ 1. $emit('close')                               │
│    ├─ 2. uni.navigateTo('/pages/trade/trade?           │
│    │    stock_code=00700')                             │
│    └─ 彈窗銷毀（v-if="visible"）                        │
│                                                       │
│  用戶點擊遮罩 / ✕ :                                    │
│    └─ $emit('close')                                  │
│                                                       │
│  watch(visible) → false:                              │
│    └─ 無需清理（下次打開重新查詢）                        │
└────────────────────────────────────────────────────────┘
```

**關鍵規則**：
- 每次 `visible` 變為 `true` 時**重新查詢** DB（不緩存上次結果）
- 彈窗關閉**先於**頁面跳轉（`$emit('close')` → 緊接 `navigateTo`）
- 彈窗內不修改數據（純查詢展示），不需要寫操作後的刷新邏輯

### 12.4 場景四：下拉刷新

```
┌─ index.vue ──────────────────────────────────────────┐
│  onPullDownRefresh:                                   │
│    ├─ 1. refreshPortfolioData()                       │
│    │    └─ 僅本地計算（無網路請求）                      │
│    ├─ 2. uni.stopPullDownRefresh()                    │
│    └─ 3. 全局 Ref 更新 → 視圖刷新                       │
│                                                       │
│  注意：不調用 refreshMarketQuotes()（下拉不發網路請求）  │
└────────────────────────────────────────────────────────┘
```

### 12.5 場景五：TabBar 切換

```
┌─ index.vue  ←→  history.vue ────────────────────────┐
│                                                       │
│  持倉 → 流水：index.onHide → history.onShow             │
│    history.onShow:                                     │
│      ├─ SELECT * FROM transactions                     │
│      │   ORDER BY trade_date DESC, created_at DESC      │
│      ├─ 應用 picker 篩選器狀態                          │
│      └─ 渲染月份分組 + 流水列表                          │
│                                                       │
│  流水 → 持倉：history.onHide → index.onShow             │
│    index.onShow:                                       │
│      └─ refreshPortfolioData()（與冷啟動相同路徑）        │
│                                                       │
│  TabBar 切換不銷毀頁面（uni-app keep-alive 默認行為）     │
│  僅觸發 onHide/onShow，不觸發 onLoad/onUnload           │
└────────────────────────────────────────────────────────┘
```

### 12.6 生命週期鉤子職責總結

| 鉤子 | 文件 | 職責 | 阻塞渲染？ |
|------|------|------|:--:|
| `onLaunch` | App.vue | 執行 `initDatabase()`（建表+遷移+初始化），完成後才掛載頁面 | ✅ 是 |
| `onShow` | index.vue | `refreshPortfolioData()` → 更新所有 Ref | ❌ 否 |
| `onShow` | history.vue | 重新查詢全量流水 + 篩選 | ❌ 否 |
| `onHide` | 所有頁面 | 無需操作（頁面保持 alive） | — |
| `onPullDownRefresh` | index.vue | `refreshPortfolioData()` + `stopPullDownRefresh()` | ❌ 否 |
| `onLoad` | trade.vue | 讀取 `options.stock_code` → 預填表單 | ❌ 否 |
| `onLoad` | dividend.vue | 同上 | ❌ 否 |
| `watch(visible)` | tx-popup.vue | 查詢個股流水 | ❌ 否 |
| `onUnload` | trade.vue | 無需操作（表單狀態在組件內，銷毀即釋放） | — |

### 12.7 異步並發保護規則

| 場景 | 保護機制 |
|------|----------|
| 行情刷新進行中 → 再次點擊刷新 | `isLoading` 鎖 + 按鈕 disabled |
| 交易提交進行中 → 再次點擊提交 | `isLoading` 鎖 + 按鈕 disabled + 文案「提交中...」 |
| 下拉刷新 + 🔄 同時觸發 | 兩個操作獨立（下拉僅本地，🔄 有網路），互不衝突 |
| onShow 觸發刷新 + 用戶點擊刷新 | `refreshPortfolioData` 非破壞性（冪等），重複調用無害 |
| 彈窗打開中 → 首頁 onShow 觸發 | 彈窗不影響首頁數據刷新（positionList 更新不干擾彈窗查詢） |

---

## 7. 本地開發環境


系統在桌面瀏覽器中運行需要一個 **SQLite 種子數據庫文件**。該文件包含 5 張空表和預導入的 `stock_universe` 數據（~100 條港股），使模糊搜索功能立即可用。

```bash
# 1. 安裝依賴
npm install

# 2. ⚠️ 生成種子數據庫文件（必須！僅需執行一次）
node scripts/init-db.mjs

# 3. （可選）生成完整港股列表（~3,100 條，需聯網，約 5 秒）
node scripts/download-hkex.mjs
# → 生成 src/data/stock_universe.json
# → 再次運行 node scripts/init-db.mjs 以導入完整列表到數據庫

# 4. 啟動開發服務器
npm run dev:h5
# → http://localhost:5173/
```

#### init-db.mjs 做了什麼

```
node scripts/init-db.mjs
  ├─ 使用 sql.js 在 Node.js 中創建 SQLite 數據庫
  ├─ 執行 DDL：CREATE TABLE IF NOT EXISTS (stocks, transactions,
  │                                      cash_account, stock_universe, schema_version)
  ├─ 創建 3 個索引
  ├─ INSERT cash_account (id=1, available_cash='0.00')
  ├─ 讀取 src/data/stock_universe.json
  └─ 批量導入 stock_universe 表（每 500 條一個事務）
       │
       ▼
  輸出兩個文件：
  ├─ public/hk_portfolio_db.db   ← Vite 靜態服務（瀏覽器 fetch 加載）
  └─ hk_portfolio_db.db         ← 項目根目錄備份
```

#### 如果跳過 init-db.mjs 會怎樣？

| 後果 | 嚴重性 | 說明 |
|------|:--:|------|
| 瀏覽器加載空白數據庫 | 🟡 | `CREATE TABLE IF NOT EXISTS` 會在建表時自動執行（db.ts 的冪等 DDL），所以表結構仍會正確創建 |
| stock_universe 為空 | 🔴 | 模糊搜索股票代碼完全不可用。用戶只能手動輸入完整代碼 |
| cash_account 缺失 | 🟡 | db.ts 的初始化邏輯會自動補償（`SELECT COUNT(*)` → 0 時插入 id=1） |
| 功能可用性 | 🟡 | 系統可以運行，但體驗嚴重降級（無模糊搜索） |

**結論**：不運行 `init-db.mjs` 不會導致系統崩潰（DDL 是冪等的），但模糊搜索不可用。**首次啟動必須執行**。

#### 數據庫文件的生命週期

```
