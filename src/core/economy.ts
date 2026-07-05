import type { UpgradeDef } from './types';

/** 升級成本：base × growth^level（指數成長，見規劃書第 4 節） */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, level));
}

/** 升級到 level 級時對該屬性的累積加成（效果線性） */
export function upgradeValue(def: UpgradeDef, level: number): number {
  return def.valuePerLevel * level;
}

export function isMaxed(def: UpgradeDef, level: number): boolean {
  return def.maxLevel > 0 && level >= def.maxLevel;
}

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'q', 'Q', 's', 'S', 'O', 'N'];

/** 大數字顯示：K/M/B/T…，超出後備援為科學記號 */
export function formatNumber(n: number): string {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1000) {
    return n < 100 && n % 1 !== 0 ? n.toFixed(1) : Math.floor(n).toString();
  }
  const tier = Math.floor(Math.log10(n) / 3);
  if (tier >= SUFFIXES.length) return n.toExponential(2).replace('+', '');
  const scaled = n / Math.pow(10, tier * 3);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return scaled.toFixed(digits) + SUFFIXES[tier];
}
