import { mulberry32 } from './rng';
import missionsData from '../data/missions.json';

export type MissionType = 'kills' | 'wave' | 'coins' | 'runs' | 'ults';

export interface MissionDef {
  id: string;
  type: MissionType;
  target: number;
  reward: number;
  name: string;
  desc: string;
}

export const MISSION_POOL = missionsData.pool as MissionDef[];
export const MISSION_CONFIG = missionsData.config as { perDay: number };

export function missionById(id: string): MissionDef | undefined {
  return MISSION_POOL.find((m) => m.id === id);
}

/** 把日期字串（YYYY-MM-DD）雜湊成種子，讓當天任務穩定不變 */
function dateSeed(dateStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 依日期決定當天的任務 id（同一天穩定、每天不同，且不重複類型優先） */
export function rollDailyMissions(dateStr: string): string[] {
  const rng = mulberry32(dateSeed(dateStr));
  const pool = MISSION_POOL.map((m) => m.id);
  const picks: string[] = [];
  const usedTypes = new Set<MissionType>();
  // 先盡量挑不同類型
  const shuffled = [...pool].sort(() => rng() - 0.5);
  for (const id of shuffled) {
    if (picks.length >= MISSION_CONFIG.perDay) break;
    const def = missionById(id)!;
    if (usedTypes.has(def.type)) continue;
    usedTypes.add(def.type);
    picks.push(id);
  }
  // 不足時補齊
  for (const id of shuffled) {
    if (picks.length >= MISSION_CONFIG.perDay) break;
    if (!picks.includes(id)) picks.push(id);
  }
  return picks;
}

/** 一場結束對某任務的進度增量（cumulative 型累加，wave 型取單場最佳） */
export function missionDelta(def: MissionDef, run: { kills: number; coins: number; wave: number; ults: number }): number {
  switch (def.type) {
    case 'kills':
      return run.kills;
    case 'coins':
      return run.coins;
    case 'ults':
      return run.ults;
    case 'runs':
      return 1;
    case 'wave':
      return run.wave; // 呼叫端以 max 累進
  }
}

export function isMissionComplete(def: MissionDef, progress: number): boolean {
  return progress >= def.target;
}
