# Tower-Defense

放置塔防遊戲（Idle Tower Defense），參考《The Tower - Idle Tower Defense》的設計方向。

- 🎮 **線上遊玩**：https://awsjin510.github.io/Tower-Defense/
- 📋 完整規劃：[docs/GAME_DESIGN_PLAN.md](docs/GAME_DESIGN_PLAN.md)
- 🍎 iOS 上架評估：[docs/IOS_RELEASE_PLAN.md](docs/IOS_RELEASE_PLAN.md)
- ☁️ Google 登入與雲端存檔：[docs/GOOGLE_CLOUD_SAVE_SETUP.md](docs/GOOGLE_CLOUD_SAVE_SETUP.md)
- 🌐 Cloudflare Worker + D1 部署：[docs/CLOUDFLARE_DEPLOYMENT.md](docs/CLOUDFLARE_DEPLOYMENT.md)

## 玩法（MVP）

守住中央的塔。敵人從四面八方湧入，塔會自動攻擊。

- **戰鬥內**：殺敵賺 **現金 $**，購買本場限定升級（攻擊/防禦/經濟三類）——死亡歸零
- **戰鬥後**：結算 **金幣 🪙**，回到工坊購買**永久**升級，下一場起點更強
- 每 10 波一隻頭目；敵人強度隨波次指數成長，總有一波會守不住——這是設計的一部分
- **主題戰區**：每 10 波切換戰區（翠綠曠野 → 寒冰荒原 → 熔岩裂谷 → 虛空深淵，循環），
  各區有獨立的敵人速度／血量／傷害／出怪量與獎勵倍率，越深入獎勵越高；
  場地以戰區主題色呈現雷達網格、能量信標與塔核心特效，HUD 同步顯示戰區名稱
- **卡片系統**：戰前配置卡片，**槽位有限**逼你取捨出流派。13 張分三類——
  數值卡（攻速/生命/範圍/爆擊/金幣）、規則卡（彈射/慢速靈氣/荊棘反傷/擊殺回血/利息）、
  條件卡（頭目剋星/策士/虛空掠奪者，與戰區、Perk 聯動）。里程碑解鎖、金幣升星（1~3★），
  不做抽卡；槽位可用金幣逐一解鎖（2→6）

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

詳見規劃書第 7 節。目前完成：**M0 原型 + M1 MVP + M2 留存**——
戰鬥、波次、場內升級、死亡結算、工坊、存檔、大數字，
加上離線收益（50% 效率、8 小時上限）、每 5 波 Perk 三選一（含高風險選項）、
狙擊手遠程敵人、Boss 召喚小兵、x1~x3 速度切換。
下一步 M3：卡片系統、研究室、終極武器、Tier 2。
