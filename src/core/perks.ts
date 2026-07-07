import type { StatId, Stats } from './types';
import perksData from '../data/perks.json';

export interface PerkMod {
  stat: StatId;
  /** 乘法加成（1.3 = +30%）；與 add 擇一 */
  mult?: number;
  /** 加法加成（暴擊率這類百分點屬性用） */
  add?: number;
}

export type PerkRarity = 'common' | 'rare' | 'epic' | 'legendary';

/** 觸發式規則：實際效果集中在模擬層，存檔只需保留 perk id */
export type PerkRule =
  | 'burn'
  | 'burnCrit'
  | 'wildfire'
  | 'frost'
  | 'brittle'
  | 'shatter'
  | 'armorBreak'
  | 'bountyBurst'
  | 'giantSlayer'
  | 'execute'
  | 'precision'
  | 'adrenaline'
  | 'doubleTap'
  | 'momentum'
  | 'frostNova'
  | 'lastStand'
  | 'apex'
  | 'multishot'
  | 'volley'
  | 'pierce'
  | 'railgun'
  | 'chainLightning'
  | 'superconductor'
  | 'satellite';

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  rarity: PerkRarity;
  /** 高風險 Perk：帶有負面代價，UI 以警示色呈現 */
  risky?: boolean;
  /** 可重複取得並疊加（數值型 Perk）；達 maxStacks 後不再進池 */
  stackable?: boolean;
  maxStacks?: number;
  mods: PerkMod[];
  /** 改變戰鬥規則的效果 */
  rule?: PerkRule;
  prerequisite?: string;
}

interface RarityWeight {
  base: number;
  wavePer10: number;
}

interface PerkConfig {
  offerEvery: number;
  choices: number;
  rerollBaseCost: number;
  rerollGrowth: number;
  skipRewardFrac: number;
  rarityWeights: Record<PerkRarity, RarityWeight>;
}

export function hasPerk(perkIds: string[], id: string): boolean {
  return perkIds.includes(id);
}

/** 某 Perk 已取得的層數 */
export function perkStacks(perkIds: string[], id: string): number {
  let n = 0;
  for (const p of perkIds) if (p === id) n++;
  return n;
}

export const PERKS = perksData.perks as PerkDef[];
export const PERK_CONFIG = perksData.config as PerkConfig;

export function perkById(id: string): PerkDef | undefined {
  return PERKS.find((p) => p.id === id);
}

export type PerkSchool = 'fire' | 'frost' | 'form' | 'risk' | 'trigger' | 'stat';
const FIRE_RULES: PerkRule[] = ['burn', 'burnCrit', 'wildfire'];
const FROST_RULES: PerkRule[] = ['frost', 'brittle', 'shatter'];
const FORM_RULES: PerkRule[] = ['multishot', 'volley', 'pierce', 'railgun', 'chainLightning', 'superconductor', 'satellite'];

export function perkSchool(def: PerkDef): PerkSchool {
  if (def.rule && FIRE_RULES.includes(def.rule)) return 'fire';
  if (def.rule && FROST_RULES.includes(def.rule)) return 'frost';
  if (def.rule && FORM_RULES.includes(def.rule)) return 'form';
  if (def.risky) return 'risk';
  if (def.rule) return 'trigger';
  return 'stat';
}

const RARITY_LABEL: Record<PerkRarity, string> = {
  common: '標準',
  rare: '稀有',
  epic: '史詩',
  legendary: '傳說',
};

export function perkRarity(def: PerkDef): string {
  return RARITY_LABEL[def.rarity] ?? '標準';
}

/** 把已取得的 Perk 套到屬性上（在升級加成之後：先加後乘）。可堆疊 Perk 靠陣列重複自然疊乘。 */
export function applyPerks(stats: Stats, perkIds: string[]): void {
  for (const id of perkIds) {
    const def = perkById(id);
    if (!def) continue;
    for (const m of def.mods) {
      if (m.add) stats[m.stat] += m.add;
      if (m.mult) stats[m.stat] *= m.mult;
    }
  }
  stats.critChance = Math.min(stats.critChance, 0.8);
}

/** 是否該在此波提供 Perk 選擇 */
export function isPerkWave(wave: number): boolean {
  return wave > 1 && wave % PERK_CONFIG.offerEvery === 0;
}

/** 某 Perk 目前是否還能進池（前置達成、未達疊加上限） */
function isEligible(def: PerkDef, taken: string[]): boolean {
  if (def.prerequisite && !taken.includes(def.prerequisite)) return false;
  const owned = perkStacks(taken, def.id);
  if (owned === 0) return true;
  if (!def.stackable) return false;
  return owned < (def.maxStacks ?? Infinity);
}

/** 稀有度在該波的抽取權重（越深、稀有度越高者權重越大） */
function rarityWeight(rarity: PerkRarity, wave: number): number {
  const w = PERK_CONFIG.rarityWeights[rarity];
  if (!w) return 1;
  return Math.max(1, w.base + w.wavePer10 * Math.floor(wave / 10));
}

/**
 * 擲出三選一：依稀有度加權、深波提高高稀有度機率，不重複抽同一 Perk。
 * 可堆疊 Perk 未達上限時仍在池中。count 可由卡片（策士）加成。
 */
export function rollPerkChoices(
  taken: string[],
  rng: () => number,
  count = PERK_CONFIG.choices,
  wave = 1
): string[] {
  const pool = PERKS.filter((p) => isEligible(p, taken)).map((p) => ({
    id: p.id,
    weight: rarityWeight(p.rarity, wave),
  }));
  const picks: string[] = [];
  while (picks.length < count && pool.length > 0) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let r = rng() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    if (idx >= pool.length) idx = pool.length - 1;
    picks.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picks;
}

/** 本場已重骰次數對應的重骰花費（場內現金） */
export function rerollCost(rerolls: number): number {
  return Math.round(PERK_CONFIG.rerollBaseCost * Math.pow(PERK_CONFIG.rerollGrowth, rerolls));
}
