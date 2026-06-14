# 港股本地持仓管理系统 - 前端视觉与样式规格书 (CSS Specification)

本文件完整定义了系统全套界面的视觉样式、十六进制金融配色案、高信息密度表格排版以及动态动画效果。专门用于引导 Claude Code 100% 还原「招商证券风」的专业信任感与港股传统「红涨绿跌」的视觉体验。

---

## 1. 全局设计规范 (Global Design Variables)

本应用采用严格的数字化资产视觉标准，禁止在业务组件中私自硬编码颜色。必须统一遵循以下色彩架构：

| 视觉元素 | 核心十六进制色值 (HEX) | 软体工程业务应用场景 |
| :--- | :--- | :--- |
| **看板背景渐变始** | `#1e3c72` | 顶层资产卡片 135 度线性渐变起点 |
| **看板背景渐变终** | `#2a5298` | 顶层资产卡片 135 度线性渐变终点 |
| **实时金融红** | `#fa4d56` | 港股传统：价格上涨、今日累加正盈亏、买入标签、快捷交易按钮 |
| **金融专业绿** | `#24a148` | 港股传统：价格下跌、今日累加负盈亏、卖出标签 |
| **分红琥珀金** | `#f1c40f` | 现金分红专属视觉、除权提示标签、分红录入按钮 |
| **高密度表头灰** | `#eeeeee` | 招商证券风多列紧凑表格的灰色底栏背景 |
| **全局背景底色** | `#f8f9fa` | 应用各分页的背景，用以拉开纯白组件的层次感 |
| **纯白实体层** | `#ffffff` | 持仓列表行、底部滑出弹窗、输入表单的底色 |

---

## 2. 核心原子级样式类定义 (Core Utility Classes)

### 2.2 基础容器与渐变看板 (.asset-card)
```css
/* 全局自适应容器 */
.container {
    background-color: #f8f9fa;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* 招商证券风格：大底深蓝渐变资产卡片 */
.asset-card {
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
    color: #ffffff;
    padding: 40rpx 30rpx;
    border-bottom-left-radius: 20rpx;
    border-bottom-right-radius: 20rpx;
    box-shadow: 0 8rpx 20rpx rgba(30, 60, 114, 0.15);
}

/* 实时价格与状态显色：具备强烈的视觉冲击力和极高的信息对比度 */
.text-red {
    color: #fa4d56 !important;
}
.text-green {
    color: #24a148 !important;
}

/* 顶层看板大字盈亏专属高亮色（内联高光） */
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

/* 表头：极低高度、灰色底栏、紧凑低调，突出下方数据 */
.list-header {
    display: flex;
    padding: 16rpx 30rpx;
    background-color: #eeeeee;
    font-size: 22rpx;
    color: #666666;
    font-weight: 600;
    letter-spacing: 1rpx;
}

/* 数据行：高信息密度，上下内边距严密收紧 */
.position-item {
    display: flex;
    align-items: center;
    padding: 24rpx 30rpx;
    background-color: #ffffff;
    border-bottom: 1rpx solid #efefef;
}

/* 栅格列宽严格配比 */
.col-left {
    flex: 3.5;
    display: flex;
    flex-direction: column;
}
.col-mid {
    flex: 3;
    text-align: right;
}
.col-right {
    flex: 3.5;
    text-align: right;
}

/* 核心骨架规则：港股 5 位代码必须绝对对齐，滚动时禁止发生左右像素抖动 */
.courier-bold-code {
    font-size: 32rpx;
    font-weight: bold;
    color: #111111;
    font-family: "Courier New", Courier, monospace; /* 强制等宽 */
    letter-spacing: 0rpx;
}
.stock-name-sub {
    font-size: 22rpx;
    color: #888888;
    margin-top: 4rpx;
}

/* 容器平滑滑出基础样式 */
.popup-content {
    background-color: #ffffff;
    border-top-left-radius: 24rpx;
    border-top-right-radius: 24rpx;
    padding: 30rpx 30rpx 40rpx 30rpx;
    max-height: 75vh;
}

/* 流水明细条目 */
.tx-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 22rpx 0;
    border-bottom: 1rpx solid #fafafa;
}

/* ---- 加载状态 ---- */
.spinner {
  display: inline-block;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.loading-overlay {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60rpx 0;
  color: #999;
  font-size: 26rpx;
}

/* ---- 空状态 ---- */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 120rpx 0;
}
.empty-icon {
  font-size: 80rpx;
  margin-bottom: 20rpx;
  opacity: 0.6;
}
.empty-text {
  font-size: 30rpx;
  color: #666;
  margin-bottom: 8rpx;
}
.empty-sub {
  font-size: 24rpx;
  color: #999;
}

/* ---- 按钮禁用态 ---- */
.btn-primary[disabled],
.btn-red[disabled],
.btn-gold[disabled] {
  opacity: 0.5;
  pointer-events: none;
}
.submit-btn[disabled],
.submit-btn-sell[disabled] {
  opacity: 0.5;
}

/* ---- 输入校验错误 ---- */
.input-error {
  border-color: #fa4d56 !important;
  background-color: #fff5f5 !important;
}
.input-error-hint {
  font-size: 22rpx;
  color: #fa4d56;
  margin-top: 8rpx;
}

/* ---- 网络错误提示 ---- */
.error-toast {
  background-color: #fff5f5;
  border: 1rpx solid #ffcccc;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  color: #fa4d56;
  font-size: 26rpx;
  text-align: center;
  margin: 20rpx 30rpx;
}

/* ---- 停牌标记 ---- */
.suspended-tag {
  display: inline-block;
  background-color: #999;
  color: #fff;
  font-size: 18rpx;
  padding: 2rpx 10rpx;
  border-radius: 4rpx;
  margin-left: 8rpx;
}

/* 复式记账全量账本中，各类流水的核心彩色标签样式 */
.badge {
    font-size: 18rpx;
    padding: 4rpx 10rpx;
    border-radius: 4rpx;
    color: #ffffff;
    width: fit-content;
    font-weight: bold;
    text-align: center;
}
.badge-buy {
    background-color: #fa4d56; /* 录入买入显红 */
}
.badge-sell {
    background-color: #24a148; /* 录入卖出显绿 */
}
.badge-dividend {
    background-color: #f1c40f; /* 录入分红显琥珀金 */
    color: #333333;
}

/* 用于 history.vue 页面全量流水的左滑滑动删除块 */
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

---

## 3. 暗色模式適配 (Dark Mode Consideration)

第一版以淺色模式為基準設計。若未來需要支援暗色模式（跟隨系統 `prefers-color-scheme: dark`），需注意以下要點：

- **背景層級反轉**：`#f8f9fa`（全局底色）→ `#1a1a2e`；`#ffffff`（卡片白）→ `#2d2d44`
- **文字層級反轉**：`#111111`（主文字）→ `#e8e8e8`；`#666666`（次文字）→ `#aaaaaa`
- **看板漸變保留**：深藍漸變卡片（`#1e3c72` → `#2a5298`）在暗色背景下仍具備高對比度，可保留不變
- **紅漲綠跌**：`#fa4d56` / `#24a148` 兩色在暗色背景下辨識度良好，可保留不變