import ultimatesData from '../data/ultimates.json';

export type UltimateKind = 'coinBuff' | 'nuke';

export interface UltimateDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: UltimateKind;
  /** 歷史最高波次達此值時解鎖（給 1 級） */
  unlockWave: number;
  baseCooldown: number;
  cooldownPerLevel: number;
  minCooldown: number;
  /** coinBuff 的持續秒數；nuke 為 0（瞬發） */
  baseDuration: number;
  durationPerLevel: number;
  /** coinBuff：金幣/現金倍率；nuke：對全體造成的塔傷倍率 */
  baseValue: number;
  valuePerLevel: number;
  baseUpgradeCost: number;
  upgradeGrowth: number;
  maxLevel: number;
}

export const ULTIMATES = ultimatesData.ultimates as UltimateDef[];

export function ultimateById(id: string): UltimateDef | undefined {
  return ULTIMATES.find((u) => u.id === id);
}

export function ultimateCooldown(def: UltimateDef, level: number): number {
  return Math.max(def.minCooldown, def.baseCooldown + def.cooldownPerLevel * (level - 1));
}

export function ultimateDuration(def: UltimateDef, level: number): number {
  return def.baseDuration + def.durationPerLevel * (level - 1);
}

export function ultimateValue(def: UltimateDef, level: number): number {
  return def.baseValue + def.valuePerLevel * (level - 1);
}

/** 從 level 升到 level+1 的金幣花費 */
export function ultimateUpgradeCost(def: UltimateDef, level: number): number {
  return Math.ceil(def.baseUpgradeCost * Math.pow(def.upgradeGrowth, level - 1));
}

export function isUltimateMaxed(def: UltimateDef, level: number): boolean {
  return level >= def.maxLevel;
}

/**
 * 解析後的終極武器實例（本場模擬只吃這個，不依賴 ultimates.json）：
 * coinBuff → coinMult/duration；nuke → damageMult。
 */
export interface ResolvedUltimate {
  id: string;
  kind: UltimateKind;
  color: string;
  cooldown: number;
  duration: number;
  /** coinBuff 的金幣倍率 */
  coinMult: number;
  /** nuke 的塔傷倍率 */
  damageMult: number;
}

export function resolveUltimate(def: UltimateDef, level: number): ResolvedUltimate {
  const value = ultimateValue(def, level);
  return {
    id: def.id,
    kind: def.kind,
    color: def.color,
    cooldown: ultimateCooldown(def, level),
    duration: ultimateDuration(def, level),
    coinMult: def.kind === 'coinBuff' ? value : 1,
    damageMult: def.kind === 'nuke' ? value : 0,
  };
}

export function describeUltimate(def: UltimateDef, level: number): string {
  const cd = Math.round(ultimateCooldown(def, level));
  if (def.kind === 'coinBuff') {
    return `${ultimateDuration(def, level)} 秒內金幣 ×${ultimateValue(def, level).toFixed(1)}（冷卻 ${cd}s）`;
  }
  return `對全場造成 ${ultimateValue(def, level).toFixed(0)}× 塔傷（冷卻 ${cd}s）`;
}
