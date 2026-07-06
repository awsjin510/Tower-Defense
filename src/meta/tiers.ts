import { TIER_CONFIG } from '../core/tiers';
import type { SaveData } from './save';

export function tierBest(save: SaveData, tier: number): number {
  return save.tierBestWave[String(tier)] ?? 0;
}

/** 可否切到某 Tier（需已解鎖） */
export function canSelectTier(save: SaveData, tier: number): boolean {
  return tier >= 1 && tier <= save.tierMax;
}

/** 選擇 Tier；成功回傳 true */
export function selectTier(save: SaveData, tier: number): boolean {
  if (!canSelectTier(save, tier)) return false;
  save.tier = tier;
  return true;
}

/**
 * 一場結束後結算 Tier 進度：更新該 Tier 最高波，達門檻則解鎖下一個 Tier。
 * 回傳新解鎖的 Tier（0 = 沒有新解鎖），供 UI 提示與發首通獎勵。
 */
export function settleTier(save: SaveData, tier: number, wave: number): number {
  const key = String(tier);
  if (wave > (save.tierBestWave[key] ?? 0)) save.tierBestWave[key] = wave;
  let unlockedTier = 0;
  if (tier === save.tierMax && save.tierMax < TIER_CONFIG.maxTier && wave >= TIER_CONFIG.unlockWave) {
    save.tierMax += 1;
    unlockedTier = save.tierMax;
    save.coins += TIER_CONFIG.firstClearCoins * unlockedTier;
  }
  return unlockedTier;
}
