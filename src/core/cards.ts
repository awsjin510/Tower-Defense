import type { StatId, Stats } from './types';
import { ZONES } from './zones';
import cardsData from '../data/cards.json';

export type CardCategory = 'stat' | 'rule' | 'cond';
export type CardKind =
  | 'stat'
  | 'bounce'
  | 'slowAura'
  | 'thorns'
  | 'lifesteal'
  | 'interest'
  | 'bossDamage'
  | 'extraPerk'
  | 'zoneDamage';

export interface CardEffect {
  kind: CardKind;
  /** kind='stat' 專用 */
  stat?: StatId;
  mode?: 'mult' | 'add';
  /** kind='zoneDamage' 專用 */
  zoneId?: string;
  /** 每顆星的效果增量 */
  perStar: number;
}

export interface CardDef {
  id: string;
  name: string;
  cat: CardCategory;
  icon: string;
  color: string;
  /** 歷史最高波次達到此值時自動解鎖（0 = 開場即有） */
  unlockWave: number;
  effect: CardEffect;
}

export interface CardConfig {
  baseSlots: number;
  maxSlots: number;
  starMax: number;
  starUpCost: Record<string, number>;
  slotCost: Record<string, number>;
}

export const CARDS = cardsData.cards as CardDef[];
export const CARD_CONFIG = cardsData.config as CardConfig;

export function cardById(id: string): CardDef | undefined {
  return CARDS.find((c) => c.id === id);
}

/** 裝備卡片對本場模擬的所有加成（乘在升級/Perk 之後；規則效果由 sim 讀取） */
export interface RunMods {
  /** 數值卡：對屬性的乘法/加法修正 */
  statMods: Array<{ stat: StatId; mult?: number; add?: number }>;
  /** 子彈額外彈射目標數 */
  bounce: number;
  /** 射程內敵人減速比例（0..1） */
  slowAura: number;
  /** 近戰受擊反彈傷害比例 */
  thorns: number;
  /** 每次擊殺回復的血量（佔血量上限比例） */
  lifestealFrac: number;
  /** 每波按現金比例生息 */
  interest: number;
  /** 對頭目的傷害倍率（1 = 無加成） */
  bossDamageMult: number;
  /** Perk 三選一額外選項數 */
  extraPerkChoices: number;
  /** 特定戰區的額外傷害倍率加成：zoneId → 加成（0.25 = +25%） */
  zoneDamage: Record<string, number>;
}

export function emptyMods(): RunMods {
  return {
    statMods: [],
    bounce: 0,
    slowAura: 0,
    thorns: 0,
    lifestealFrac: 0,
    interest: 0,
    bossDamageMult: 1,
    extraPerkChoices: 0,
    zoneDamage: {},
  };
}

/** 卡片在某星級的效果數值 */
export function cardValue(def: CardDef, star: number): number {
  return def.effect.perStar * star;
}

/** 由「已裝備卡片 + 各卡星級」組出本場加成。starOf 回傳 0 代表未裝備/未擁有。 */
export function buildRunMods(equipped: string[], starOf: (id: string) => number): RunMods {
  const mods = emptyMods();
  for (const id of equipped) {
    const def = cardById(id);
    const star = starOf(id);
    if (!def || star <= 0) continue;
    const v = cardValue(def, star);
    const e = def.effect;
    switch (e.kind) {
      case 'stat':
        if (!e.stat) break;
        mods.statMods.push(e.mode === 'add' ? { stat: e.stat, add: v } : { stat: e.stat, mult: 1 + v });
        break;
      case 'bounce':
        mods.bounce += Math.round(v);
        break;
      case 'slowAura':
        mods.slowAura = Math.min(mods.slowAura + v, 0.6);
        break;
      case 'thorns':
        mods.thorns += v;
        break;
      case 'lifesteal':
        mods.lifestealFrac += v;
        break;
      case 'interest':
        mods.interest += v;
        break;
      case 'bossDamage':
        mods.bossDamageMult += v;
        break;
      case 'extraPerk':
        mods.extraPerkChoices += Math.round(v);
        break;
      case 'zoneDamage':
        if (e.zoneId) mods.zoneDamage[e.zoneId] = (mods.zoneDamage[e.zoneId] ?? 0) + v;
        break;
    }
  }
  return mods;
}

/** 把數值卡的屬性修正套到屬性上（在升級與 Perk 之後） */
export function applyCardStatMods(stats: Stats, statMods: RunMods['statMods']): void {
  for (const m of statMods) {
    if (m.add) stats[m.stat] += m.add;
    if (m.mult) stats[m.stat] *= m.mult;
  }
  stats.critChance = Math.min(stats.critChance, 0.8);
}

/** 卡片在某星級的效果文字（0 星時顯示 1 星預覽） */
export function describeCard(def: CardDef, star: number): string {
  const s = Math.max(star, 1);
  const v = cardValue(def, s);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  switch (def.effect.kind) {
    case 'stat':
      return def.effect.mode === 'add' ? `${def.name} +${pct(v)}` : `${def.name} +${pct(v)}`;
    case 'bounce':
      return `子彈彈射 +${Math.round(v)} 目標`;
    case 'slowAura':
      return `射程內敵人減速 ${pct(Math.min(v, 0.6))}`;
    case 'thorns':
      return `近戰反彈 ${pct(v)} 傷害`;
    case 'lifesteal':
      return `擊殺回復 ${pct(v)} 血量上限`;
    case 'interest':
      return `每波生息 +${pct(v)} 現金`;
    case 'bossDamage':
      return `對頭目傷害 +${pct(v)}`;
    case 'extraPerk':
      return `Perk 選項 +${Math.round(v)}`;
    case 'zoneDamage': {
      const zone = ZONES.find((z) => z.id === def.effect.zoneId);
      return `${zone?.name ?? '特定戰區'}傷害 +${pct(v)}`;
    }
  }
}
