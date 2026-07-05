import { WORKSHOP_UPGRADES } from '../core/stats';
import { upgradeCost, isMaxed } from '../core/economy';
import { runCoinRate } from '../core/offline';
import type { SaveData } from './save';

/** 工坊購買；直接改動 save 物件，成功回傳 true */
export function buyWorkshopUpgrade(save: SaveData, upgradeId: string): boolean {
  const def = WORKSHOP_UPGRADES.find((u) => u.id === upgradeId);
  if (!def) return false;
  const level = save.workshopLevels[upgradeId] ?? 0;
  if (isMaxed(def, level)) return false;
  const cost = upgradeCost(def, level);
  if (save.coins < cost) return false;
  save.coins -= cost;
  save.workshopLevels[upgradeId] = level + 1;
  return true;
}

/** 一場結束的結算：把場內成果寫進永久存檔 */
export function settleRun(
  save: SaveData,
  result: { wave: number; coinsEarned: number; kills: number; timeSec?: number }
): void {
  save.coins += result.coinsEarned;
  save.bestWave = Math.max(save.bestWave, result.wave);
  save.totalRuns += 1;
  save.totalKills += result.kills;
  if (result.timeSec) {
    save.coinRate = Math.max(save.coinRate, runCoinRate(result.coinsEarned, result.timeSec));
  }
}
