import { buyInRunUpgrade, newRun, step, TICK_DT, type SimState } from '../src/core/sim';
import { IN_RUN_UPGRADES, WORKSHOP_UPGRADES, type Levels } from '../src/core/stats';
import { upgradeCost, isMaxed } from '../src/core/economy';
import { buyWorkshopUpgrade } from '../src/meta/workshop';
import type { SaveData } from '../src/meta/save';

/** 貪婪策略：反覆購買「買得起的最便宜」場內升級 */
function greedyBuyInRun(s: SimState): void {
  for (;;) {
    let bestId: string | null = null;
    let bestCost = Infinity;
    for (const def of IN_RUN_UPGRADES) {
      const lv = s.inRunLevels[def.id] ?? 0;
      if (isMaxed(def, lv)) continue;
      const cost = upgradeCost(def, lv);
      if (cost <= s.cash && cost < bestCost) {
        bestCost = cost;
        bestId = def.id;
      }
    }
    if (!bestId || !buyInRunUpgrade(s, bestId)) return;
  }
}

/** 用貪婪 AI 自動打完一整場，回傳最終狀態（模擬時間上限 2 小時防呆） */
export function autoplayRun(workshopLevels: Levels, seed: number): SimState {
  const s = newRun(workshopLevels, seed);
  const maxTicks = Math.floor((2 * 3600) / TICK_DT);
  for (let tick = 0; tick < maxTicks && !s.over; tick++) {
    step(s, TICK_DT);
    if (tick % 15 === 0) greedyBuyInRun(s);
  }
  return s;
}

/** 貪婪花光工坊金幣 */
export function greedySpendWorkshop(save: SaveData): void {
  for (;;) {
    let bestId: string | null = null;
    let bestCost = Infinity;
    for (const def of WORKSHOP_UPGRADES) {
      const lv = save.workshopLevels[def.id] ?? 0;
      if (isMaxed(def, lv)) continue;
      const cost = upgradeCost(def, lv);
      if (cost <= save.coins && cost < bestCost) {
        bestCost = cost;
        bestId = def.id;
      }
    }
    if (!bestId || !buyWorkshopUpgrade(save, bestId)) return;
  }
}
