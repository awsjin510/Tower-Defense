import { describe, expect, it } from 'vitest';
import { BOSS_ARCHETYPES, ELITE_AFFIXES, ROUTES, bossArchetypeForWave, chooseRoute, newRun } from '../src/core/sim';
import { CARDS, CARD_SETS, buildRunMods } from '../src/core/cards';
import { tierMods } from '../src/core/tiers';
import { defaultSave } from '../src/meta/save';
import { syncCardUnlocks } from '../src/meta/cards';

describe('stage 3 encounters and route choice', () => {
  it('提供八種菁英詞綴與四種循環 Boss', () => {
    expect(new Set(ELITE_AFFIXES).size).toBe(8);
    expect(BOSS_ARCHETYPES).toHaveLength(4);
    expect([10,20,30,40].map(bossArchetypeForWave)).toEqual(BOSS_ARCHETYPES);
    expect(bossArchetypeForWave(50)).toBe(BOSS_ARCHETYPES[0]);
  });
  it('路線選擇會切換風險與報酬', () => {
    const s = newRun({}, 7); s.pendingRoute = true;
    expect(chooseRoute(s, 'danger')).toBe(true);
    expect(s.activeRoute).toBe('danger');
    expect(ROUTES.danger.reward).toBeGreaterThan(ROUTES.safe.reward);
  });
  it('戰報初始化所有傷害來源', () => {
    const s = newRun({}, 1);
    expect(Object.keys(s.damageBreakdown)).toHaveLength(8);
    expect(s.damageTaken).toBe(0);
  });
});

describe('stage 4 cards, challenges and tier matrix', () => {
  it('共有 36 張卡、10 套套裝，跨流派可組出起始規則', () => {
    expect(CARDS).toHaveLength(36); expect(CARD_SETS).toHaveLength(10);
    const mods = buildRunMods(['thermalshock','stormcoil','thermalcore'], () => 3);
    expect(mods.startPerks).toEqual(expect.arrayContaining(['incendiary','cryoRounds','chainLightning','superconductor']));
  });
  it('挑戰條件未達不解鎖，達成後才解鎖', () => {
    const save = defaultSave(); save.bestWave = 999;
    syncCardUnlocks(save); expect(save.cards.voidanchor ?? 0).toBe(0);
    save.tierMax = 8; save.totalRuns = 99; save.totalKills = 9999;
    syncCardUnlocks(save); expect(save.cards.voidanchor).toBe(1);
  });
  it('Tier 1–8 的 HP、傷害與獎勵皆為有限且單調上升', () => {
    const matrix = Array.from({length:8}, (_,i) => tierMods(i+1));
    for (const key of ['hp','dmg','reward'] as const) {
      expect(matrix.every((m) => Number.isFinite(m[key]))).toBe(true);
      for (let i=1;i<matrix.length;i++) expect(matrix[i][key]).toBeGreaterThan(matrix[i-1][key]);
    }
  });
});
