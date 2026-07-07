import type { Stats, UpgradeDef } from './types';
import { upgradeValue } from './economy';
import { applyResearch } from './research';
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
  freeUpgradeChance: 0,
  projectileSpeed: 460,
  armorPen: 0,
  knockback: 0,
  elementalPower: 1,
  eliteDamage: 1,
  armor: 0,
  damageReduction: 0,
  energyShield: 0,
  interestRate: 0,
  splashChance: 0,
  thorns: 0,
  killHeal: 0,
  upgradeDiscount: 0,
  eliteBounty: 1,
};

export type Levels = Record<string, number>;

export interface UpgradeMilestone { level: number; name: string; desc: string }
export const UPGRADE_MILESTONES: Record<string, UpgradeMilestone[]> = {
  damage: [{ level: 20, name: '爆裂彈頭', desc: '命中造成 35% 範圍傷害' }],
  attackSpeed: [{ level: 20, name: '超頻連射', desc: '每第 5 發追加一發' }],
  range: [{ level: 10, name: '壓制領域', desc: '射程內敵人額外減速 8%' }],
  maxHealth: [{ level: 20, name: '護盾重整', desc: '每波獲得 10% 最大生命護盾' }],
  healthRegen: [{ level: 20, name: '溢能修復', desc: '滿血時回復轉為護盾' }],
  interestRate: [{ level: 10, name: '頭目複利', desc: 'Boss 波利息翻倍' }],
  knockback: [{ level: 10, name: '震盪核心', desc: '擊退效果提升 50%' }],
  splashChance: [{ level: 10, name: '連鎖爆破', desc: '爆炸半徑與傷害提升' }],
  thorns: [{ level: 10, name: '尖刺堡壘', desc: '反傷可作用於遠程敵人' }],
  killHeal: [{ level: 10, name: '收割修復', desc: '擊殺菁英時回復加倍' }],
  upgradeDiscount: [{ level: 10, name: '批量採購', desc: '折扣上限提高至 35%' }],
  eliteBounty: [{ level: 10, name: '頭目懸賞', desc: 'Boss 獎勵再提高 25%' }],
};

export function nextMilestone(id: string, level: number): UpgradeMilestone | undefined {
  return UPGRADE_MILESTONES[id]?.find((m) => level < m.level);
}

/**
 * 屬性 = 基礎值 + 工坊永久加成 + 研究永久加成 + 場內升級加成。
 * 存檔只存等級，屬性一律重算 —— 改平衡表後舊存檔自動生效。
 */
export function computeStats(workshopLevels: Levels, inRunLevels: Levels, researchLevels: Levels = {}): Stats {
  const stats: Stats = { ...BASE_STATS };
  for (const def of WORKSHOP_UPGRADES) {
    stats[def.stat] += upgradeValue(def, workshopLevels[def.id] ?? 0);
  }
  for (const def of IN_RUN_UPGRADES) {
    stats[def.stat] += upgradeValue(def, inRunLevels[def.id] ?? 0);
  }
  applyResearch(stats, researchLevels);
  stats.critChance = Math.min(stats.critChance, 0.8);
  stats.damageReduction = Math.min(stats.damageReduction, 0.65);
  stats.armorPen = Math.min(stats.armorPen, 0.8);
  stats.splashChance = Math.min(stats.splashChance, 0.75);
  stats.thorns = Math.min(stats.thorns, 1.5);
  stats.killHeal = Math.min(stats.killHeal, 0.08);
  stats.upgradeDiscount = Math.min(stats.upgradeDiscount, 0.35);
  return stats;
}
