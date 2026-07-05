import type { StatId, Stats } from './types';
import perksData from '../data/perks.json';

export interface PerkMod {
  stat: StatId;
  /** 乘法加成（1.3 = +30%）；與 add 擇一 */
  mult?: number;
  /** 加法加成（暴擊率這類百分點屬性用） */
  add?: number;
}

export interface PerkDef {
  id: string;
  name: string;
  desc: string;
  /** 高風險 Perk：帶有負面代價，UI 以警示色呈現 */
  risky?: boolean;
  mods: PerkMod[];
}

export const PERKS = perksData.perks as PerkDef[];
export const PERK_CONFIG = perksData.config as { offerEvery: number; choices: number };

export function perkById(id: string): PerkDef | undefined {
  return PERKS.find((p) => p.id === id);
}

/** 把已取得的 Perk 套到屬性上（在升級加成之後：先加後乘） */
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

/** 擲出三選一：從尚未取得的 Perk 池抽（不重複），池不足時給剩餘全部 */
export function rollPerkChoices(taken: string[], rng: () => number): string[] {
  const pool = PERKS.filter((p) => !taken.includes(p.id)).map((p) => p.id);
  const picks: string[] = [];
  while (picks.length < PERK_CONFIG.choices && pool.length > 0) {
    picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return picks;
}
