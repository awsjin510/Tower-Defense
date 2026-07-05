import type { Levels } from '../core/stats';

export const SAVE_VERSION = 2;
const SAVE_KEY = 'tower-defense-save';

export interface SaveData {
  version: number;
  coins: number;
  workshopLevels: Levels;
  bestWave: number;
  totalRuns: number;
  totalKills: number;
  /** 最後一次永久進度變更時間，用於本機與雲端衝突判定。 */
  updatedAt: number;
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    workshopLevels: {},
    bestWave: 0,
    totalRuns: 0,
    totalKills: 0,
    updatedAt: 0,
  };
}

/**
 * 舊版存檔逐版升級到最新版。存檔只存「等級與貨幣」不存屬性值，
 * 所以平衡表改動不需要遷移。
 */
export function migrate(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) return defaultSave();
  const data = { ...defaultSave(), ...(raw as Partial<SaveData>) };
  // 未來版本的遷移在這裡逐段加：if (data.version === 1) { ...; data.version = 2 }
  data.version = SAVE_VERSION;
  return data;
}

export interface SaveStore {
  load(): SaveData;
  save(data: SaveData): void;
}

/** 保留同一個物件參考，讓已綁定 UI 的程式可以安全套用雲端存檔。 */
export function applySave(target: SaveData, source: SaveData): void {
  Object.assign(target, source, { workshopLevels: { ...source.workshopLevels } });
}

/** 瀏覽器 localStorage 實作；core 測試時可注入記憶體版 */
export function localStorageStore(): SaveStore {
  return {
    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        return raw ? migrate(JSON.parse(raw)) : defaultSave();
      } catch {
        return defaultSave();
      }
    },
    save(data: SaveData) {
      try {
        data.updatedAt = Date.now();
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        // 儲存失敗（隱私模式等）不應讓遊戲崩潰
      }
    },
  };
}
