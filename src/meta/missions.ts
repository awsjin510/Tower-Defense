import { isMissionComplete, missionById, missionDelta, rollDailyMissions } from '../core/missions';
import type { DailyMission, SaveData } from './save';

/** 本機時區的今日字串 YYYY-MM-DD */
export function todayStr(now = Date.now()): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 確保存檔的每日任務對應到 dateStr。跨日時重新產生（進度歸零）。
 * 回傳是否有重置（供 UI 提示「新任務」）。
 */
export function ensureDaily(save: SaveData, dateStr = todayStr()): boolean {
  if (save.dailyDate === dateStr && save.dailyMissions.length > 0) return false;
  save.dailyDate = dateStr;
  save.dailyMissions = rollDailyMissions(dateStr).map((id) => ({ id, progress: 0, claimed: false }));
  return true;
}

/** 一場結束後更新任務進度（wave 型取單場最佳、其餘累加） */
export function applyRunToMissions(
  save: SaveData,
  run: { kills: number; coins: number; wave: number; ults: number }
): void {
  for (const m of save.dailyMissions) {
    const def = missionById(m.id);
    if (!def) continue;
    const delta = missionDelta(def, run);
    m.progress = def.type === 'wave' ? Math.max(m.progress, delta) : m.progress + delta;
  }
}

/** 領取已完成的任務獎勵；回傳發出的金幣（0 = 不可領） */
export function claimMission(save: SaveData, id: string): number {
  const m = save.dailyMissions.find((x) => x.id === id);
  const def = m && missionById(m.id);
  if (!m || !def || m.claimed || !isMissionComplete(def, m.progress)) return 0;
  m.claimed = true;
  save.coins += def.reward;
  return def.reward;
}

/** 目前可領取的任務數（供頂欄紅點提示） */
export function claimableCount(save: SaveData): number {
  let n = 0;
  for (const m of save.dailyMissions) {
    const def = missionById(m.id);
    if (def && !m.claimed && isMissionComplete(def, m.progress)) n++;
  }
  return n;
}

export function missionState(save: SaveData): DailyMission[] {
  return save.dailyMissions;
}
