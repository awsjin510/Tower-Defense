# Tower-Defense

放置塔防遊戲（Idle Tower Defense），參考《The Tower - Idle Tower Defense》的設計方向。

- 🎮 **線上遊玩**：https://awsjin510.github.io/Tower-Defense/
- 📋 完整規劃：[docs/GAME_DESIGN_PLAN.md](docs/GAME_DESIGN_PLAN.md)
- 🍎 iOS 上架評估：[docs/IOS_RELEASE_PLAN.md](docs/IOS_RELEASE_PLAN.md)
- ☁️ Google 登入與雲端存檔：[docs/GOOGLE_CLOUD_SAVE_SETUP.md](docs/GOOGLE_CLOUD_SAVE_SETUP.md)

## 玩法（MVP）

守住中央的塔。敵人從四面八方湧入，塔會自動攻擊。

- **戰鬥內**：殺敵賺 **現金 $**，購買本場限定升級（攻擊/防禦/經濟三類）——死亡歸零
- **戰鬥後**：結算 **金幣 🪙**，回到工坊購買**永久**升級，下一場起點更強
- 每 10 波一隻頭目；敵人強度隨波次指數成長，總有一波會守不住——這是設計的一部分

## 開發

```bash
npm install
npm run dev      # 開發伺服器
npm run build    # 產出 dist/（相對路徑，可直接丟任何靜態空間）
npm test         # 單元測試 + 平衡守門測試
```

## 專案結構

```
src/core/    純遊戲邏輯，不碰渲染、不碰瀏覽器 API（可獨立測試，未來可直接移植 Godot）
  sim.ts       固定 tick 戰鬥模擬（生成/移動/索敵/傷害）
  economy.ts   升級成本/效果公式、大數字格式化
  waves.ts     波次組成與敵人數值曲線
  stats.ts     屬性計算（基礎 + 工坊 + 場內）
src/data/    全部數值設定（JSON）——平衡是改表，不是改 code
src/meta/    存檔（含版本遷移）、工坊
src/ui/      Canvas 渲染
src/main.ts  畫面切換與主迴圈（固定 tick 模擬 + 每幀渲染，x1~x3 加速）
tests/       單元測試 + balance.test.ts（貪婪 AI 自動打整場，守住數值曲線目標）
```

## 平衡調整流程

1. 改 `src/data/upgrades.json` / `src/data/enemies.json`
2. `npm run balance` —— 貪婪 AI 模擬多場進度曲線，驗證：
   - 首場死亡波數 10~30、時長 3~15 分鐘
   - 連打 5 場後波數 ≥ 首場 1.3 倍（工坊成長有感）

## 路線圖

詳見規劃書第 7 節。目前完成：**M0 原型 + M1 MVP**（戰鬥、波次、場內升級、死亡結算、工坊、存檔、大數字）。
下一步 M2：離線收益、Perk 三選一、Boss 特殊能力、遠程敵人。
