import { RESEARCH, isResearchMaxed, researchById, researchCost, researchTimeSec } from '../core/research';
import type { ActiveResearch, SaveData } from './save';

export function researchLevel(save: SaveData, id: string): number {
  return save.researchLevels[id] ?? 0;
}

/**
 * 開始一項研究：需閒置、金幣足夠、未達上限。以真實時間 now(ms) 起算。
 * 成功回傳 true 並扣款、設定 activeResearch。
 */
export function startResearch(save: SaveData, id: string, now: number): boolean {
  if (save.activeResearch) return false;
  const def = researchById(id);
  if (!def) return false;
  const level = researchLevel(save, id);
  if (isResearchMaxed(def, level)) return false;
  const cost = researchCost(def, level);
  if (save.coins < cost) return false;
  save.coins -= cost;
  save.activeResearch = {
    id,
    startedAt: now,
    completesAt: now + researchTimeSec(def, level) * 1000,
  };
  return true;
}

/**
 * 若進行中的研究已到期（真實時間），完成之：等級 +1、清空佇列。
 * 離線期間也適用——開啟遊戲時呼叫即補完。回傳完成的研究 id 或 null。
 */
export function collectResearch(save: SaveData, now: number): string | null {
  const active = save.activeResearch;
  if (!active || now < active.completesAt) return null;
  save.researchLevels[active.id] = researchLevel(save, active.id) + 1;
  save.activeResearch = null;
  return active.id;
}

/** 進行中研究的剩餘秒數（無研究或已完成回 0） */
export function researchRemainingSec(save: SaveData, now: number): number {
  if (!save.activeResearch) return 0;
  return Math.max(0, Math.ceil((save.activeResearch.completesAt - now) / 1000));
}

/** 進行中研究的完成進度 0..1 */
export function researchProgress(save: SaveData, now: number): number {
  const a: ActiveResearch | null = save.activeResearch;
  if (!a) return 0;
  const total = a.completesAt - a.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - a.startedAt) / total));
}

/** 所有研究等級加總（供 UI 顯示「研究總等級」） */
export function totalResearchLevels(save: SaveData): number {
  return RESEARCH.reduce((sum, def) => sum + researchLevel(save, def.id), 0);
}
