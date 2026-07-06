import { describe, expect, it } from 'vitest';
import { TIER_CONFIG, tierMods } from '../src/core/tiers';
import { newRun, step, TICK_DT } from '../src/core/sim';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import { canSelectTier, selectTier, settleTier, tierBest } from '../src/meta/tiers';

describe('tier core', () => {
  it('T1 倍率全為 1，高 Tier 遞增', () => {
    const t1 = tierMods(1);
    expect(t1.hp).toBe(1);
    expect(t1.dmg).toBe(1);
    expect(t1.reward).toBe(1);
    const t3 = tierMods(3);
    expect(t3.hp).toBeGreaterThan(1);
    expect(t3.reward).toBeGreaterThan(t3.hp); // 獎勵成長快於血量
  });

  it('高 Tier 敵人更硬、獎勵更高', () => {
    const t1 = newRun({}, 5, undefined, {}, [], 1);
    const t3 = newRun({}, 5, undefined, {}, [], 3);
    // 推進到有敵人生成
    for (let i = 0; i < 60; i++) { step(t1, TICK_DT); step(t3, TICK_DT); }
    const e1 = t1.enemies[0];
    const e3 = t3.enemies[0];
    expect(e3.maxHp).toBeGreaterThan(e1.maxHp);
    expect(e3.cashValue).toBeGreaterThan(e1.cashValue);
  });

  it('未帶 tier 參數時預設 T1（既有行為不變）', () => {
    const a = newRun({}, 9);
    const b = newRun({}, 9, undefined, {}, [], 1);
    for (let i = 0; i < 60; i++) { step(a, TICK_DT); step(b, TICK_DT); }
    expect(a.enemies.map((e) => e.maxHp)).toEqual(b.enemies.map((e) => e.maxHp));
  });
});

describe('tier meta', () => {
  it('存檔升到 v8：tier/tierMax/tierBestWave 補齊', () => {
    const v7 = {
      version: 7, coins: 1, workshopLevels: {}, bestWave: 1, totalRuns: 0, totalKills: 0,
      updatedAt: 1, coinRate: 0, lastSeenAt: 0, playerId: 'X', cards: {}, equipped: [], cardSlots: 2,
      researchLevels: {}, activeResearch: null, ultimates: {},
    };
    const m = migrate(v7);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.tier).toBe(1);
    expect(m.tierMax).toBe(1);
    expect(m.tierBestWave).toEqual({});
  });

  it('只能選已解鎖的 Tier', () => {
    const save = defaultSave();
    expect(canSelectTier(save, 1)).toBe(true);
    expect(canSelectTier(save, 2)).toBe(false);
    expect(selectTier(save, 2)).toBe(false);
    save.tierMax = 3;
    expect(selectTier(save, 3)).toBe(true);
    expect(save.tier).toBe(3);
    expect(selectTier(save, 4)).toBe(false);
  });

  it('達門檻解鎖下一 Tier 並發首通獎勵；未達不解鎖', () => {
    const save = defaultSave();
    // 未達門檻
    expect(settleTier(save, 1, TIER_CONFIG.unlockWave - 1)).toBe(0);
    expect(save.tierMax).toBe(1);
    // 達門檻
    const coinsBefore = save.coins;
    const unlocked = settleTier(save, 1, TIER_CONFIG.unlockWave);
    expect(unlocked).toBe(2);
    expect(save.tierMax).toBe(2);
    expect(save.coins).toBe(coinsBefore + TIER_CONFIG.firstClearCoins * 2);
    // 各 Tier 記錄獨立最高波
    expect(tierBest(save, 1)).toBe(TIER_CONFIG.unlockWave);
    // 已在最高 Tier 但只在較低 Tier 打不會再解鎖
    save.tier = 2;
    expect(settleTier(save, 1, 999)).toBe(0);
    expect(save.tierMax).toBe(2);
  });

  it('tierBestWave 只增不減', () => {
    const save = defaultSave();
    settleTier(save, 1, 15);
    settleTier(save, 1, 8);
    expect(tierBest(save, 1)).toBe(15);
  });
});
