import type { Levels } from '../core/stats';

export const SAVE_VERSION = 7;
const SAVE_KEY = 'tower-defense-save';

/** 進行中的研究：以真實時間計，離線也在推進 */
export interface ActiveResearch {
  id: string;
  startedAt: number;
  completesAt: number;
}

export interface SaveData {
  version: number;
  coins: number;
  workshopLevels: Levels;
  bestWave: number;
  totalRuns: number;
  totalKills: number;
  /** 最後一次永久進度變更時間，用於本機與雲端衝突判定。 */
  updatedAt: number;
  /** 歷史最佳的每秒金幣產出，離線收益據此估算（v3 起） */
  coinRate: number;
  /** 最後一次在線時間；開啟遊戲時據此結算離線收益（v3 起） */
  lastSeenAt: number;
  /** 穩定的本機帳號代碼（16 位大寫十六進位）：帳戶識別、Email 連動、客服查詢用（v4 起） */
  playerId: string;
  /** 卡片星級：id → 星等（0 未擁有、1~3 星）（v5 起） */
  cards: Record<string, number>;
  /** 已裝備的卡片 id（上限 = cardSlots）（v5 起） */
  equipped: string[];
  /** 已解鎖的卡槽數（v5 起） */
  cardSlots: number;
  /** 研究等級：id → 等級（v6 起） */
  researchLevels: Record<string, number>;
  /** 進行中的研究（單一佇列）；null 表示閒置（v6 起） */
  activeResearch: ActiveResearch | null;
  /** 終極武器等級：id → 等級（0 未解鎖、1+ 可用）（v7 起） */
  ultimates: Record<string, number>;
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
    coinRate: 0,
    lastSeenAt: 0,
    playerId: '',
    cards: {},
    equipped: [],
    cardSlots: 2,
    researchLevels: {},
    activeResearch: null,
    ultimates: {},
  };
}

/** 產生一組 16 位大寫十六進位帳號代碼 */
export function newPlayerId(): string {
  let id = '';
  for (let i = 0; i < 16; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id.toUpperCase();
}

/** 確保存檔帶有帳號代碼（首次呼叫時產生），回傳該代碼。不主動寫檔，交由下次存檔持久化。 */
export function ensurePlayerId(save: SaveData): string {
  if (!save.playerId) save.playerId = newPlayerId();
  return save.playerId;
}

/**
 * 舊版存檔逐版升級到最新版。存檔只存「等級與貨幣」不存屬性值，
 * 所以平衡表改動不需要遷移。
 */
export function migrate(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) return defaultSave();
  const data = { ...defaultSave(), ...(raw as Partial<SaveData>) };
  // 未來版本的遷移在這裡逐段加：if (data.version === 1) { ...; data.version = 2 }
  // v2 → v3：coinRate / lastSeenAt 由 defaultSave 補 0，首次上線不結算離線收益。
  // v3 → v4：playerId 由 defaultSave 補 ''，首次開啟由 ensurePlayerId 產生。
  // v4 → v5：cards / equipped / cardSlots 由 defaultSave 補預設（無卡、2 槽）。
  // v5 → v6：researchLevels / activeResearch 由 defaultSave 補預設（無研究、閒置）。
  // v6 → v7：ultimates 由 defaultSave 補 {}（無終極武器）。
  data.version = SAVE_VERSION;
  return data;
}

export interface SaveStore {
  load(): SaveData;
  save(data: SaveData): void;
}

/** 保留同一個物件參考，讓已綁定 UI 的程式可以安全套用雲端存檔。 */
export function applySave(target: SaveData, source: SaveData): void {
  Object.assign(target, source, {
    workshopLevels: { ...source.workshopLevels },
    cards: { ...(source.cards ?? {}) },
    equipped: [...(source.equipped ?? [])],
    researchLevels: { ...(source.researchLevels ?? {}) },
    activeResearch: source.activeResearch ? { ...source.activeResearch } : null,
    ultimates: { ...(source.ultimates ?? {}) },
  });
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
