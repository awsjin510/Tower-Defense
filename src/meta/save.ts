import type { Levels } from '../core/stats';

export const SAVE_VERSION = 1;
const SAVE_KEY = 'tower-defense-save';

export interface SaveData {
  version: number;
  coins: number;
  workshopLevels: Levels;
  bestWave: number;
  totalRuns: number;
  totalKills: number;
}

export function defaultSave(): SaveData {
  return { version: SAVE_VERSION, coins: 0, workshopLevels: {}, bestWave: 0, totalRuns: 0, totalKills: 0 };
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
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      } catch {
        // 儲存失敗（隱私模式等）不應讓遊戲崩潰
      }
    },
  };
}
