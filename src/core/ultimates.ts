import ultimatesData from '../data/ultimates.json';

export type UltimateKind = 'coinBuff' | 'blackhole' | 'orbital' | 'timeFreeze';
export type UltimateBranch = 'power' | 'cycle' | 'variant';

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
  branch?: UltimateBranch;
}

export function resolveUltimate(def: UltimateDef, level: number, branch?: UltimateBranch): ResolvedUltimate {
  const value = ultimateValue(def, level);
  const power = branch === 'power' ? 1.35 : 1;
  const cycle = branch === 'cycle' ? .75 : 1;
  const variantDuration = branch === 'variant' ? 1.35 : 1;
  return {
    id: def.id,
    kind: def.kind,
    color: def.color,
    cooldown: ultimateCooldown(def, level) * cycle,
    duration: ultimateDuration(def, level) * variantDuration,
    coinMult: def.kind === 'coinBuff' ? value : 1,
    damageMult: def.kind === 'coinBuff' ? 0 : value * power,
    branch,
  };
}

export function describeUltimate(def: UltimateDef, level: number): string {
  const cd = Math.round(ultimateCooldown(def, level));
  if (def.kind === 'coinBuff') return `${ultimateDuration(def, level)} 秒金幣 ×${ultimateValue(def, level).toFixed(1)}；連殺提高倍率`;
  if (def.kind === 'blackhole') return `吸怪 ${ultimateDuration(def, level)} 秒後造成 ${ultimateValue(def, level).toFixed(0)}× 塔傷`;
  if (def.kind === 'orbital') return `${ultimateDuration(def, level)} 秒鎖定菁英轟炸，單次 ${ultimateValue(def, level).toFixed(0)}× 塔傷`;
  return `凍結全場 ${ultimateDuration(def, level)} 秒，期間塔可繼續攻擊`;
}
