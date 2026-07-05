import { describe, expect, it } from 'vitest';
import {
  RESEARCH,
  applyResearch,
  isResearchMaxed,
  researchCost,
  researchTimeSec,
  researchValue,
} from '../src/core/research';
import { BASE_STATS, computeStats } from '../src/core/stats';
import { newRun } from '../src/core/sim';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import {
  collectResearch,
  researchLevel,
  researchProgress,
  researchRemainingSec,
  startResearch,
  totalResearchLevels,
} from '../src/meta/research';

describe('research data & formulas', () => {
  it('資料健全：id 不重複、有圖示/顏色、成本與時間為正、隨等級遞增', () => {
    expect(new Set(RESEARCH.map((r) => r.id)).size).toBe(RESEARCH.length);
    for (const def of RESEARCH) {
      expect(def.icon.length).toBeGreaterThan(0);
      expect(def.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(researchCost(def, 0)).toBeGreaterThan(0);
      expect(researchTimeSec(def, 1)).toBeGreaterThan(researchTimeSec(def, 0));
      expect(researchCost(def, 1)).toBeGreaterThan(researchCost(def, 0));
      expect(researchValue(def, 2)).toBeCloseTo(def.valuePerLevel * 2);
    }
  });

  it('applyResearch 疊加到屬性、computeStats 併入研究層', () => {
    const def = RESEARCH.find((r) => r.stat === 'damage')!;
    const stats = { ...BASE_STATS };
    applyResearch(stats, { [def.id]: 3 });
    expect(stats.damage).toBeCloseTo(BASE_STATS.damage + def.valuePerLevel * 3);

    const withR = computeStats({}, {}, { [def.id]: 3 });
    const without = computeStats({}, {});
    expect(withR.damage).toBeGreaterThan(without.damage);
  });

  it('研究加成讓開場屬性更強（newRun 帶入 researchLevels）', () => {
    const hpDef = RESEARCH.find((r) => r.stat === 'maxHealth')!;
    const weak = newRun({}, 1);
    const strong = newRun({}, 1, undefined, { [hpDef.id]: 5 });
    expect(strong.stats.maxHealth).toBeGreaterThan(weak.stats.maxHealth);
    expect(strong.towerHp).toBeGreaterThan(weak.towerHp);
  });
});

describe('research meta (real-time queue)', () => {
  it('存檔升到 v6：researchLevels/activeResearch 補齊', () => {
    const v5 = {
      version: 5, coins: 5, workshopLevels: {}, bestWave: 1, totalRuns: 0, totalKills: 0,
      updatedAt: 1, coinRate: 0, lastSeenAt: 0, playerId: 'X', cards: {}, equipped: [], cardSlots: 2,
    };
    const m = migrate(v5);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.researchLevels).toEqual({});
    expect(m.activeResearch).toBeNull();
  });

  it('開始研究：扣金幣、設定到期時間、單槽互斥', () => {
    const save = defaultSave();
    save.coins = 100000;
    const id = RESEARCH[0].id;
    const t0 = 1_000_000;
    expect(startResearch(save, id, t0)).toBe(true);
    expect(save.activeResearch?.id).toBe(id);
    expect(save.activeResearch!.completesAt).toBe(t0 + researchTimeSec(RESEARCH[0], 0) * 1000);
    // 已有研究進行中 → 不能再開第二個
    expect(startResearch(save, RESEARCH[1].id, t0)).toBe(false);
  });

  it('金幣不足不能開始', () => {
    const save = defaultSave();
    save.coins = 0;
    expect(startResearch(save, RESEARCH[0].id, 0)).toBe(false);
    expect(save.activeResearch).toBeNull();
  });

  it('收成：到期前不完成、到期後等級 +1 並清空佇列（含離線）', () => {
    const save = defaultSave();
    save.coins = 100000;
    const def = RESEARCH[0];
    const t0 = 0;
    startResearch(save, def.id, t0);
    const dur = researchTimeSec(def, 0) * 1000;
    // 未到期
    expect(collectResearch(save, t0 + dur - 1)).toBeNull();
    expect(researchLevel(save, def.id)).toBe(0);
    // 到期（模擬離線很久後開啟）
    expect(collectResearch(save, t0 + dur + 999_999)).toBe(def.id);
    expect(researchLevel(save, def.id)).toBe(1);
    expect(save.activeResearch).toBeNull();
  });

  it('剩餘秒數與進度隨時間推進', () => {
    const save = defaultSave();
    save.coins = 100000;
    const def = RESEARCH[0];
    startResearch(save, def.id, 0);
    const dur = researchTimeSec(def, 0) * 1000;
    expect(researchRemainingSec(save, 0)).toBe(researchTimeSec(def, 0));
    expect(researchProgress(save, dur / 2)).toBeCloseTo(0.5, 1);
    expect(researchProgress(save, dur * 2)).toBe(1);
    expect(researchRemainingSec(save, dur * 2)).toBe(0);
  });

  it('達上限後不能再開始研究', () => {
    const save = defaultSave();
    save.coins = 1e12;
    const def = RESEARCH[0];
    save.researchLevels[def.id] = def.maxLevel;
    expect(isResearchMaxed(def, def.maxLevel)).toBe(true);
    expect(startResearch(save, def.id, 0)).toBe(false);
  });

  it('totalResearchLevels 加總各線等級', () => {
    const save = defaultSave();
    save.researchLevels = { [RESEARCH[0].id]: 3, [RESEARCH[1].id]: 2 };
    expect(totalResearchLevels(save)).toBe(5);
  });
});
