/**
 * Tier 難度階梯（取代傳統重生）：同一套戰區/卡片/Perk，全域套上一層敵人倍率。
 * 高 Tier 敵人更硬更痛，但獎勵成長更快——撐得住就值得農。
 * 每個 Tier 有獨立的最高波紀錄，達門檻解鎖下一個 Tier。
 */
export const TIER_CONFIG = {
  maxTier: 8,
  /** 在某 Tier 到達此波即解鎖下一個 Tier */
  unlockWave: 20,
  hpGrowth: 2.0,
  dmgGrowth: 1.7,
  rewardGrowth: 2.6,
  /** 首次解鎖新 Tier 的金幣獎勵（× 新 Tier 序號） */
  firstClearCoins: 400,
};

export interface TierMods {
  hp: number;
  dmg: number;
  reward: number;
}

/** Tier T 的全域敵人倍率（T1 = 全 1） */
export function tierMods(tier: number): TierMods {
  const t = Math.max(0, tier - 1);
  return {
    hp: TIER_CONFIG.hpGrowth ** t,
    dmg: TIER_CONFIG.dmgGrowth ** t,
    reward: TIER_CONFIG.rewardGrowth ** t,
  };
}

export function tierLabel(tier: number): string {
  return `T${tier}`;
}
