# 港股持倉管理系統 — UI 設計與樣式規格書

本文檔合併了原 `design.md`（頁面佈局）和 `css.md`（視覺樣式），是系統 UI 實現的**唯一視覺真相源**。

---

## 1. 全局設計變量 (Global Design Tokens)

### 1.1 核心色板

| 視覺元素 | 色值 (HEX) | 應用場景 |
|:---|:---|:---|
| **看板背景漸變始** | `#1e3c72` | 資產卡片 135 度線性漸變起點 |
| **看板背景漸變終** | `#2a5298` | 資產卡片 135 度線性漸變終點 |
| **金融紅（漲）** | `#fa4d56` | 價格上漲、正盈虧、買入標籤、交易按鈕 |
| **金融綠（跌）** | `#24a148` | 價格下跌、負盈虧、賣出標籤 |
| **分紅琥珀金** | `#f1c40f` | 分紅專屬視覺、除權提示、分紅按鈕 |
| **表頭灰** | `#eeeeee` | 多列緊湊表格的灰色底欄 |
| **全局背景** | `#f8f9fa` | 應用各分頁底色，與白色組件拉開層次 |
| **純白實體** | `#ffffff` | 持倉列表行、彈窗、表單底色 |

### 1.2 看板卡片顏色層級

| 層級 | 字號 | 字重 | 顏色 | 說明 |
|------|------|------|------|------|
| 總資產標籤 | 22rpx | 400 | `rgba(255,255,255,0.6)` | 小字灰白 |
| 總資產數字 | 56rpx | 700 | `#FFFFFF` | 最大最醒目 |
| 二級標籤 | 20rpx | 400 | `rgba(255,255,255,0.5)` | 總市值/可用現金 |
| 二級數字 | 28rpx | 600 | `#FFFFFF` | 總市值/可用現金 |
| 三級標籤 | 22rpx | 400 | `rgba(255,255,255,0.5)` | 盈虧行標籤 |
| 三級數字（正） | 32rpx | 600 | `#ff6b6b` | 盈虧金額（紅） |
| 三級數字（負） | 32rpx | 600 | `#2ecc71` | 盈虧金額（綠） |
| 三級數字（零/中性） | 32rpx | 600 | `#FFFFFF` | 淨投入等 |
| 更新時間 | 18rpx | 400 | `rgba(255,255,255,0.4)` | 最小字 |
| 已實現/淨投入 | 28rpx | 500 | `rgba(255,255,255,0.65)` | 輔助信息 |

### 1.3 屏幕參數

| 參數 | 值 |
|------|-----|
| 機型 | iPhone 15 Pro Max |
| 邏輯分辨率 | 430 × 932 pt |
| uni-app 設計基準 | 750 rpx |
| rpx → pt 換算 | 1 rpx ≈ 0.573 pt |
| 有效內容寬度 | 690 rpx（30rpx 左右內邊距） |
| 安全區頂部 | 狀態欄 + 導航欄 ≈ 88 pt ≈ 154 rpx |
| 安全區底部 | TabBar ≈ 83 pt ≈ 145 rpx |
| 可視內容高度 | 932 - 88 - 83 ≈ 761 pt ≈ 1328 rpx |

---

## 2. 核心原子級樣式類 (Core CSS Utilities)

定義於 `src/uni.scss`，所有頁面共用。

### 2.1 基礎容器

```scss
.container {
    background-color: #f8f9fa;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.asset-card {
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
    color: #ffffff;
    padding: 40rpx 30rpx;
    border-bottom-left-radius: 20rpx;
    border-bottom-right-radius: 20rpx;
    box-shadow: 0 8rpx 20rpx rgba(30, 60, 114, 0.15);
}
```

### 2.2 顏色工具類

```scss
.text-red    { color: #fa4d56 !important; }
.text-green  { color: #24a148 !important; }

// 看板內高亮色（帶文字陰影，僅深色背景上使用）
.text-red-bright {
    color: #ff6b6b !important;
    font-weight: bold;
    text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.2);
}
.text-green-bright {
    color: #2ecc71 !important;
    font-weight: bold;
    text-shadow: 0 2rpx 4rpx rgba(0, 0, 0, 0.2);
}
```

### 2.3 列表結構

```scss
.list-header {
    display: flex;
    padding: 16rpx 30rpx;
    background-color: #eeeeee;
    font-size: 22rpx;
    color: #666666;
    font-weight: 600;
    letter-spacing: 1rpx;
}

.position-item {
    display: flex;
    align-items: center;
    padding: 24rpx 30rpx;
    background-color: #ffffff;
    border-bottom: 1rpx solid #efefef;
}
```

### 2.4 網格列寬

```scss
.col-left  { flex: 3.5; display: flex; flex-direction: column; }
.col-mid   { flex: 3;   text-align: right; }
.col-right { flex: 3.5; text-align: right; }
```

### 2.5 代碼與名稱

```scss
.courier-bold-code {
    font-size: 32rpx;
    font-weight: bold;
    color: #111111;
    font-family: "Courier New", Courier, monospace; // 強制等寬
    letter-spacing: 0rpx;
}
.stock-name-sub {
    font-size: 22rpx;
    color: #888888;
    margin-top: 4rpx;
}
```

### 2.6 彈窗

```scss
.popup-content {
    background-color: #ffffff;
    border-top-left-radius: 24rpx;
    border-top-right-radius: 24rpx;
    padding: 30rpx 30rpx 40rpx 30rpx;
    max-height: 75vh;
}
```

### 2.7 流水明細

```scss
.tx-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 22rpx 0;
    border-bottom: 1rpx solid #fafafa;
}
```

### 2.8 Badge 標籤

```scss
.badge {
    font-size: 18rpx;
    padding: 4rpx 10rpx;
    border-radius: 4rpx;
    color: #ffffff;
    width: fit-content;
    font-weight: bold;
    text-align: center;
}
.badge-buy       { background-color: #fa4d56; }
.badge-sell      { background-color: #24a148; }
.badge-dividend  { background-color: #f1c40f; color: #333333; }
```

### 2.9 刪除按鈕

```scss
.btn-swipe-delete {
    background-color: #fa4d56;
    color: #ffffff;
    width: 120rpx;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 24rpx;
    font-weight: bold;
}
```

### 2.10 加載與空狀態

```scss
.spinner {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-overlay {
  display: flex; justify-content: center; align-items: center;
  padding: 60rpx 0; color: #999; font-size: 26rpx;
}
.empty-state {
  display: flex; flex-direction: column; align-items: center;
  padding: 120rpx 0;
}
.empty-icon  { font-size: 80rpx; margin-bottom: 20rpx; opacity: 0.6; }
.empty-text  { font-size: 30rpx; color: #666; margin-bottom: 8rpx; }
.empty-sub   { font-size: 24rpx; color: #999; }
```

### 2.11 按鈕與輸入狀態

```scss
.btn-primary[disabled], .btn-red[disabled], .btn-gold[disabled] {
  opacity: 0.5; pointer-events: none;
}
.submit-btn[disabled], .submit-btn-sell[disabled] {
  opacity: 0.5;
}
.input-error {
  border-color: #fa4d56 !important;
  background-color: #fff5f5 !important;
}
.input-error-hint {
  font-size: 22rpx; color: #fa4d56; margin-top: 8rpx;
}
.error-toast {
  background-color: #fff5f5;
  border: 1rpx solid #ffcccc;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  color: #fa4d56; font-size: 26rpx; text-align: center;
  margin: 20rpx 30rpx;
}
```

### 2.12 停牌標記

```scss
.suspended-tag {
  display: inline-block;
  background-color: #999;
  color: #fff; font-size: 18rpx;
  padding: 2rpx 10rpx;
  border-radius: 4rpx; margin-left: 8rpx;
}
```

---

## 3. 資產持倉大盤頁 (`pages/index/index.vue`)

### 3.1 頁面結構

```
┌─────────────────────────────────┐  ← 導航欄 154rpx
│ ← 持倉                🔄  ⚙️  │
├─────────────────────────────────┤
│                                 │
│  ▓▓▓▓▓▓ 看板卡片 ▓▓▓▓▓▓▓▓▓    │  ~420rpx
│  ▓▓▓▓ 深藍漸變底色 ▓▓▓▓▓▓▓    │
│                                 │
├─────────────────────────────────┤
│  表頭：代碼/名稱 │ 行情 │ 持倉   │  48rpx
├─────────────────────────────────┤
│  持倉行 × N（可滾動區域）        │  ~140rpx/行
├─────────────────────────────────┤
│  [ 買賣股票 ]   [ 錄入分紅 ]     │  100rpx
├─────────────────────────────────┤
│  TabBar                         │  145rpx
└─────────────────────────────────┘
```

### 3.2 看板卡片佈局

```
┌──────────────────────────────────────────┐
│  總資產 (HKD)                             │  標籤 22rpx
│  ¥ 1,250,000.00                         │  數字 56rpx 粗體
│                                          │
│  ┌──────────────┬──────────────┐         │
│  │ 總市值        │ 可用現金      │         │  28rpx
│  │ 1,380,000.00 │ -130,000.00  │         │
│  └──────────────┴──────────────┘         │
│                                          │
│  ┌──────────────┬──────────────┐         │
│  │ 今日盈虧      │ 今日收益率    │         │  32rpx 紅/綠
│  ├──────────────┼──────────────┤         │
│  │ 累計盈虧      │ 累計收益率    │         │  32rpx 紅/綠
│  ├──────────────┼──────────────┤         │
│  │ 已實現盈虧    │ 淨投入        │         │  28rpx 輔助色
│  └──────────────┴──────────────┘         │
│                                          │
│  行情更新：14:30                         │  18rpx
└──────────────────────────────────────────┘
```

### 3.3 持倉列表行佈局

每行 3 行信息，總高約 140rpx。

```
┌──────────────────────────────────────────────────┐
│  00700  騰訊控股                        占 32.5%  │  Row 1
│  330.00 +2.50%  │ +15,200 +28.5%  │ 1,000 股      │  Row 2
│  均 320.50      │ 今盈 +1,520     │ 市值 33.0萬    │  Row 3
└──────────────────────────────────────────────────┘
```

#### 網格系統（690rpx）

| 列 | 寬度 | 對齊 | Row 1 | Row 2 | Row 3 |
|----|------|------|-------|-------|-------|
| 左 | 310rpx | 左 | 代碼 + 名稱 | 現價 + 漲跌幅 | 均價（灰） |
| 中 | 190rpx | 右 | — | 盈虧額 + 盈虧% | 今日盈虧（灰小） |
| 右 | 190rpx | 右 | 佔比% | 持股數量 | 市值 |

#### 各元素規格

| 元素 | 字號 | 字體 | 顏色 |
|------|------|------|------|
| 代碼 | 32rpx | Courier New 粗體 | #111 |
| 名稱 | 22rpx | 系統默認 | #888 |
| 佔比% | 24rpx | 系統默認 | #666 |
| 現價 | 28rpx | 系統默認 粗體 | #111（紅/綠） |
| 漲跌幅% | 24rpx | 系統默認 | #fa4d56 / #24a148 |
| 盈虧額 | 28rpx | 系統默認 粗體 | #fa4d56 / #24a148 |
| 盈虧% | 24rpx | 系統默認 | #fa4d56 / #24a148 |
| 持股數 | 28rpx | 系統默認 | #111 |
| 均價 | 22rpx | 系統默認 | #999 |
| 個股今盈 | 22rpx | 系統默認 | #fa4d56 / #24a148 |
| 市值 | 24rpx | 系統默認 | #666 |

#### 顏色規則

- 現價 ≥ 昨收 → 紅 (`#fa4d56`)，< 綠 (`#24a148`)
- 漲跌幅% 跟隨現價方向
- 盈虧額/盈虧%：市值 ≥ 除權後總成本 → 紅；成本 < 0（完全回本）→ 紅；其他 → 綠
- 佔比%：始終灰色

#### 格式規則

- 市值 > 100 萬 → `XXX.X萬`；> 1 億 → `X.XX億`；否則精確到兩位小數
- 佔比% 保留一位小數

---

## 4. 全量流水賬本頁 (`pages/history/history.vue`)

### 4.1 頁面結構

```
┌─────────────────────────────────┐
│ ← 流水賬本                       │  導航欄
├─────────────────────────────────┤
│ [全部 ▼]                        │  Picker 篩選 80rpx
├─────────────────────────────────┤
│ 2025年6月              共 5 筆   │  月份分組 56rpx, bg #f0f1f5
├─────────────────────────────────┤
│ 流水行 × N                      │  ~80rpx/行
├─────────────────────────────────┤
│ 2025年5月              共 3 筆   │
├─────────────────────────────────┤
│ ...                             │
└─────────────────────────────────┘
```

### 4.2 月份分組標題

| 元素 | 說明 |
|------|------|
| 高度 | 56rpx |
| 背景色 | `#f0f1f5`（淺灰藍） |
| 字號 | 24rpx, `#666` |
| 內邊距 | 16rpx 30rpx |
| 交互 | 可點擊折疊/展開，預設展開，右側 ▼/▶ 圖標 |

### 4.3 流水行佈局

單行 80rpx，信息橫向排列：

```
06-09  00700 騰訊  [BUY]   +1,000   費 50.00   -320,050.00
```

| 列 | 寬度 | 內容 | 字號 | 說明 |
|----|------|------|------|------|
| 日期 | 100rpx | `06-09` | 24rpx, #666 | MM-DD |
| 股票 | 180rpx | `00700 騰訊` | 26/20rpx | 兩行緊湊 |
| 類型 | 70rpx | badge | 18rpx | BUY(紅)/SELL(綠)/DIV(金) |
| 數量 | 100rpx | `+1,000`/`-500`/`—` | 26rpx | 右對齊 |
| 手續費 | 90rpx | `費 50.00` 或空 | 22rpx, #999 | 右對齊 |
| 現金 | 150rpx | `-320,050.00` | 26rpx, 紅/綠 | 右對齊 |

備註行：整行下方 20rpx #999 灰色顯示。

### 4.4 左滑刪除

紅色按鈕 120rpx，白色字「刪除」，二次確認（`uni.showModal`）。

---

## 5. 股票買賣錄入頁 (`pages/trade/trade.vue`)

### 5.1 頁面結構

```
┌─────────────────────────────────┐
│ ← 返回    股票交易               │
├─────────────────────────────────┤
│  ┌──────────┬──────────┐        │
│  │   買入   │   賣出   │        │  Tab 88rpx
│  └──────────┴──────────┘        │
├─────────────────────────────────┤
│  股票代碼（模糊搜索）             │
│  選中後顯示名稱 + 持倉資訊        │
├─────────────────────────────────┤
│  數量           單價              │  同行並排
│  手續費          交易日期         │  同行並排
│  備註                            │  textarea
├─────────────────────────────────┤
│  [       確認買入/賣出         ]  │  88rpx, 紅/綠
└─────────────────────────────────┘
```

### 5.2 表單字段規格

| 字段 | 高度 | 字號 | 說明 |
|------|------|------|------|
| 標籤 | 40rpx | 26rpx, #666 | 字段名 |
| 輸入框 | 80rpx | 30rpx | 圓角 12rpx, border #ddd |
| 下拉項 | 56rpx | 28rpx | 代碼 + 名稱 |
| 數量/單價 | 80rpx × 330rpx | 30rpx | 同行並排 |
| 手續費/日期 | 80rpx × 330rpx | 30rpx | 同行並排 |
| 備註 | 120rpx | 28rpx | 多行 textarea |
| 提交按鈕 | 88rpx | 32rpx 白色字 | 圓角 16rpx |

---

## 6. 分紅錄入頁 (`pages/dividend/dividend.vue`)

```
股票代碼     [模糊搜索]
✅ 騰訊控股
當前持倉：1,000 股 | 均價 320.50

分紅總額     [_________]
扣稅/手續費  [___0_____]

┌─────────────────────────────┐
│ 📌 實收分紅淨額：HKD 4,800.00 │  除權預覽卡片
│ 除權後持倉均價：315.50        │  bg #fafbfc, border #e8e8e8
│ （原均價 320.50 ↓ 5.00）     │  圓角 12rpx, 內邊距 24rpx
└─────────────────────────────┘

除權日期     [2025-06-09]
備註         [_________]

[       確認錄入分紅          ]   琥珀金色 #f1c40f
```

---

## 7. 個股歷史流水彈窗 (`components/tx-popup/tx-popup.vue`)

```
┌─────────────────────────────────┐
│          （遮罩 50% 黑）          │
├─────────────────────────────────┤  頂部圓角 24rpx
│  00700  騰訊控股            ✕   │
│  持倉 1,000 股 | 均價 320.50     │  頭部 bg #f8f9fa
│  成本盈虧：+15,200.00（紅）       │
├─────────────────────────────────┤
│  日期     類型   數量  單價  費   │  流水表頭
│  06-09   [BUY]  +500  320  50   │  流水行 64rpx
│  06-05   [DIV]   —     —   —    │
│  ...（max-height: 55vh 滾動）    │
├─────────────────────────────────┤
│  [ 去交易 ]    [ 錄入此股分紅 ]   │  底部 120rpx
└─────────────────────────────────┘
```

| 元素 | 值 |
|------|-----|
| 頂部圓角 | 24rpx |
| 最大高度 | 55vh |
| 頭部高度 | ~140rpx |
| 頭部字號 | 代碼 32rpx Courier / 名稱 24rpx #888 |
| 流水行高 | 64rpx |
| 關閉按鈕 ✕ | 右上角，44rpx，觸控區 60rpx |

---

## 8. 頁面間導航流

```
TabBar                   獨立頁面（navigateTo）
┌──────────┐            ┌──────────────┐
│  持倉頁   │──點擊行──→│  tx-popup     │
│ (index)  │           │  彈窗         │
│   ⚙️     │──齒輪──→│  admin.vue    │
│          │←──返回───│  trade.vue    │
│          │           │  dividend.vue │
├──────────┤           └──────────────┘
│  流水頁   │
│(history) │
└──────────┘
```

- 持倉頁 → 點擊行 → 彈窗（不離開持倉頁）
- 持倉頁 → ⚙️ → navigateTo admin.vue（後台管理）
- admin.vue → 導航欄 ← 返回持倉頁
- 彈窗 → 快捷按鈕 → 關閉彈窗 → navigateTo 交易/分紅頁
- 交易/分紅頁 → 提交成功 → navigateBack → 持倉頁 onShow 刷新
- TabBar 切換 → 各自 onShow 刷新

---

## 9. 全局常量

### 間距

| 常量 | 值 | 用途 |
|------|-----|------|
| 頁面水平內邊距 | 30rpx | 所有內容區 |
| 卡片內邊距 | 30rpx | 看板、彈窗 |
| 行內邊距 | 24rpx 30rpx | 持倉行、流水行 |
| 元素垂直間距 | 16rpx | 同組內元素 |
| 組垂直間距 | 32rpx | 不同信息組 |

### 圓角

| 元素 | 值 |
|------|-----|
| 看板卡片 | 底部 20rpx |
| 彈窗 | 頂部 24rpx |
| 按鈕 | 16rpx |
| 輸入框 | 12rpx |
| Badge | 4rpx |

### 字號體系

| 層級 | 字號 | 用途 |
|------|------|------|
| H1 | 56rpx | 總資產數字 |
| H2 | 32rpx | 看板盈虧數字、代碼、按鈕文字 |
| H3 | 28rpx | 二級數字（市值/現金）、列表現價/盈虧 |
| Body | 26rpx | 表單輸入、流水代碼 |
| Caption | 24rpx | 日期、佔比、漲跌幅 |
| Small | 22rpx | 均價、手續費、名稱 |
| Tiny | 20rpx | 標籤（總市值等） |
| Micro | 18rpx | 更新時間、備註 |

### TabBar 圖標

| 文件 | 用途 | 說明 |
|------|------|------|
| `static/tab-portfolio.png` | 持倉（未選中） | 佔位圖，灰色 81×81 |
| `static/tab-portfolio-active.png` | 持倉（選中） | 佔位圖，深藍 81×81 |
| `static/tab-history.png` | 流水（未選中） | 佔位圖，灰色 81×81 |
| `static/tab-history-active.png` | 流水（選中） | 佔位圖，深藍 81×81 |

> 注意：當前為佔位圖。正式上線前需替換為專業設計的圖標。

---

## 10. 暗色模式適配（未來考慮）

第一版以淺色模式為基準。若未來需支援暗色模式（`prefers-color-scheme: dark`）：

- **背景反轉**：`#f8f9fa` → `#1a1a2e`；`#ffffff` → `#2d2d44`
- **文字反轉**：`#111111` → `#e8e8e8`；`#666666` → `#aaaaaa`
- **看板漸變保留**：`#1e3c72` → `#2a5298` 在暗色下仍具高對比度
- **紅漲綠跌保留**：`#fa4d56` / `#24a148` 在暗色下辨識度良好
