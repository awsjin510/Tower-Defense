import type { Stats, UpgradeDef } from './types';
import { upgradeValue } from './economy';
import upgradesData from '../data/upgrades.json';

export const IN_RUN_UPGRADES = upgradesData.inRun as UpgradeDef[];
export const WORKSHOP_UPGRADES = upgradesData.workshop as UpgradeDef[];

/** 未升級時的基礎屬性（單一事實來源） */
export const BASE_STATS: Stats = {
  damage: 9,
  attackSpeed: 1.0,
  critChance: 0.05,
  critFactor: 1.5,
  range: 170,
  maxHealth: 120,
  healthRegen: 0.6,
  cashPerKill: 1.0,
  cashPerWave: 20,
  coinBonus: 1.0,
};

export type Levels = Record<string, number>;

/**
 * 屬性 = 基礎值 + 工坊永久加成 + 場內升級加成。
 * 存檔只存等級，屬性一律重算 —— 改平衡表後舊存檔自動生效。
 */
export function computeStats(workshopLevels: Levels, inRunLevels: Levels): Stats {
  const stats: Stats = { ...BASE_STATS };
  for (const def of WORKSHOP_UPGRADES) {
    stats[def.stat] += upgradeValue(def, workshopLevels[def.id] ?? 0);
  }
  for (const def of IN_RUN_UPGRADES) {
    stats[def.stat] += upgradeValue(def, inRunLevels[def.id] ?? 0);
  }
  stats.critChance = Math.min(stats.critChance, 0.8);
  return stats;
}
