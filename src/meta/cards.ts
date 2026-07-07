import { CARDS, CARD_CONFIG, cardById } from '../core/cards';
import type { SaveData } from './save';

/** 卡片目前星級（0 = 未擁有） */
export function cardStar(save: SaveData, id: string): number {
  return save.cards[id] ?? 0;
}

/**
 * 依歷史最高波次自動解鎖新卡（0→1 星）。回傳這次新解鎖的卡片 id 清單，
 * 供 UI 提示。已擁有的卡不受影響。
 */
export function syncCardUnlocks(save: SaveData): string[] {
  const unlocked: string[] = [];
  for (const def of CARDS) {
    const challengeMet = save.bestWave >= def.unlockWave && save.tierMax >= (def.unlockTier ?? 1)
      && save.totalRuns >= (def.unlockRuns ?? 0) && save.totalKills >= (def.unlockKills ?? 0);
    if (challengeMet && (save.cards[def.id] ?? 0) < 1) {
      save.cards[def.id] = 1;
      unlocked.push(def.id);
    }
  }
  return unlocked;
}

/** 升到目標星級的花費；已達上限回傳 null */
export function starUpCost(star: number): number | null {
  if (star < 1 || star >= CARD_CONFIG.starMax) return null;
  return CARD_CONFIG.starUpCost[String(star + 1)] ?? null;
}

/** 花金幣把卡片升一星；成功回傳 true */
export function buyStarUp(save: SaveData, id: string): boolean {
  if (!cardById(id)) return false;
  const star = cardStar(save, id);
  const cost = starUpCost(star);
  if (cost === null) return false;
  const shardCost = star === 1 ? 15 : 35;
  if (save.coins >= cost) save.coins -= cost;
  else if (save.cardShards >= shardCost) save.cardShards -= shardCost;
  else return false;
  save.cards[id] = star + 1;
  return true;
}

/** 解鎖下一個卡槽的花費；已達上限回傳 null */
export function slotUnlockCost(save: SaveData): number | null {
  const next = save.cardSlots + 1;
  if (next > CARD_CONFIG.maxSlots) return null;
  return CARD_CONFIG.slotCost[String(next)] ?? null;
}

/** 花金幣解鎖一個卡槽；成功回傳 true */
export function buySlot(save: SaveData): boolean {
  const cost = slotUnlockCost(save);
  if (cost === null || save.coins < cost) return false;
  save.coins -= cost;
  save.cardSlots += 1;
  return true;
}

/**
 * 切換卡片裝備狀態。已裝備→卸下；未裝備→在有空槽且已擁有時裝上。
 * 回傳操作後是否為「已裝備」。
 */
export function toggleEquip(save: SaveData, id: string): boolean {
  const idx = save.equipped.indexOf(id);
  if (idx >= 0) {
    save.equipped.splice(idx, 1);
    return false;
  }
  if (cardStar(save, id) <= 0) return false;
  if (save.equipped.length >= save.cardSlots) return false;
  save.equipped.push(id);
  return true;
}

/** 移除超出目前槽數或已不再擁有的裝備（槽位/存檔異動後的防呆） */
export function pruneEquipped(save: SaveData): void {
  save.equipped = save.equipped.filter((id) => cardStar(save, id) > 0).slice(0, save.cardSlots);
}

/** 把目前裝備儲存到 0-based 預設槽。 */
export function savePreset(save: SaveData, index: number): boolean {
  if (index < 0 || index >= 5) return false;
  save.cardPresets[index] = [...save.equipped];
  return true;
}

/** 套用預設；未擁有或超出目前槽位的卡片會安全略過。 */
export function applyPreset(save: SaveData, index: number): boolean {
  const preset = save.cardPresets[index];
  if (!preset || preset.length === 0) return false;
  save.equipped = preset.filter((id) => cardStar(save, id) > 0).slice(0, save.cardSlots);
  return true;
}
