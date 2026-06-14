# 港股本地持倉管理系統 — 文檔索引

## 給 AI 的快速導航

| 你想做什麼 | 去哪裡 |
|------------|--------|
| 按順序實現功能 | [tasks.md](tasks.md) — 執行主線，逐條任務 |
| 查詢類型/接口定義 | [types.md](types.md) — 所有 TS 接口的唯一定義 |
| 理解系統架構和運作原理 | [architecture.md](architecture.md) — 分層、數據庫、API、生命週期 |
| 實現 UI 樣式和佈局 | [ui-design.md](ui-design.md) — 顏色、字號、間距、組件佈局 |
| 了解編碼規則和約束 | [conventions.md](conventions.md) — 命名、錯誤處理、安全、離線策略、文檔治理 |
| 理解系統要做什麼 | [requirements.md](requirements.md) — 需求原始意圖 |
| 寫完代碼後驗證 | [tests/test-plan.md](tests/test-plan.md) — 227 個測試用例 |

## 衝突裁決順序

當多個文檔對同一事實有不同描述時：

```
1. tasks.md          ← 最高（執行主線）
2. types.md          ← 類型定義
3. architecture.md   ← 架構決策
4. conventions.md    ← 編碼規則
5. ui-design.md      ← 視覺規範（僅 UI 衝突時）
6. requirements.md   ← 原始需求（僅 tasks.md 有遺漏時回查）
7. test-plan.md      ← 不參與裁決（它是驗證標準）
```

## 文檔結構

```
docs/
├── README.md           ← 你正在看的
├── requirements.md     ← 需求（WHAT）
├── architecture.md     ← 架構（HOW）
├── types.md            ← 類型（INTERFACES）
├── ui-design.md        ← 視覺（LOOK）
├── conventions.md      ← 規則（RULES）
├── tasks.md            ← 執行（DO）
└── tests/
    └── test-plan.md    ← 驗證（VERIFY）
```

## 快速開始

```bash
npm install
node scripts/download-hkex.mjs    # 下載港交所股票列表
node scripts/init-db.mjs          # 生成種子數據庫
npm run dev:h5                    # 啟動 → http://localhost:5173
npm test                          # 跑全部測試
```
