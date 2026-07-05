import {
  ULTIMATES,
  isUltimateMaxed,
  resolveUltimate,
  ultimateById,
  ultimateUpgradeCost,
  type ResolvedUltimate,
} from '../core/ultimates';
import type { SaveData } from './save';

export function ultimateLevel(save: SaveData, id: string): number {
  return save.ultimates[id] ?? 0;
}

/**
 * 依歷史最高波次自動解鎖終極武器（0→1 級）。回傳新解鎖的 id 清單。
 */
export function syncUltimateUnlocks(save: SaveData): string[] {
  const unlocked: string[] = [];
  for (const def of ULTIMATES) {
    if (save.bestWave >= def.unlockWave && (save.ultimates[def.id] ?? 0) < 1) {
      save.ultimates[def.id] = 1;
      unlocked.push(def.id);
    }
  }
  return unlocked;
}

/** 升級花費；已達上限回傳 null */
export function ultimateUpgradePrice(save: SaveData, id: string): number | null {
  const def = ultimateById(id);
  if (!def) return null;
  const level = ultimateLevel(save, id);
  if (level < 1 || isUltimateMaxed(def, level)) return null;
  return ultimateUpgradeCost(def, level);
}

/** 花金幣升級終極武器；成功回傳 true */
export function buyUltimateUpgrade(save: SaveData, id: string): boolean {
  const price = ultimateUpgradePrice(save, id);
  if (price === null || save.coins < price) return false;
  save.coins -= price;
  save.ultimates[id] = ultimateLevel(save, id) + 1;
  return true;
}

/** 本場可用的終極武器（已解鎖者，解析成模擬用參數） */
export function resolvedUltimates(save: SaveData): ResolvedUltimate[] {
  const out: ResolvedUltimate[] = [];
  for (const def of ULTIMATES) {
    const level = ultimateLevel(save, def.id);
    if (level >= 1) out.push(resolveUltimate(def, level));
  }
  return out;
}
