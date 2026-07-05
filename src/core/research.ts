import type { StatId, Stats } from './types';
import type { Levels } from './stats';
import researchData from '../data/research.json';

/**
 * 研究室：放置遊戲的招牌長期機制——用「真實時間」跑研究佇列，
 * 離線也在推進。每條研究線給永久屬性加成（與工坊同構，但以時間為主要成本）。
 */
export interface ResearchDef {
  id: string;
  name: string;
  icon: string;
  color: string;
  stat: StatId;
  valuePerLevel: number;
  baseCost: number;
  costGrowth: number;
  baseTimeSec: number;
  timeGrowth: number;
  maxLevel: number;
}

export const RESEARCH = researchData.research as ResearchDef[];

export function researchById(id: string): ResearchDef | undefined {
  return RESEARCH.find((r) => r.id === id);
}

/** 到 level 級的累積屬性加成（線性） */
export function researchValue(def: ResearchDef, level: number): number {
  return def.valuePerLevel * level;
}

/** 從 level 升到 level+1 的金幣花費（指數） */
export function researchCost(def: ResearchDef, level: number): number {
  return Math.ceil(def.baseCost * Math.pow(def.costGrowth, level));
}

/** 從 level 升到 level+1 需要的真實秒數（指數） */
export function researchTimeSec(def: ResearchDef, level: number): number {
  return Math.round(def.baseTimeSec * Math.pow(def.timeGrowth, level));
}

export function isResearchMaxed(def: ResearchDef, level: number): boolean {
  return level >= def.maxLevel;
}

/** 把研究等級的永久加成套到屬性上（與工坊同層，於基礎值之上相加） */
export function applyResearch(stats: Stats, researchLevels: Levels): void {
  for (const def of RESEARCH) {
    stats[def.stat] += researchValue(def, researchLevels[def.id] ?? 0);
  }
}
