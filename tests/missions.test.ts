import { describe, expect, it } from 'vitest';
import { MISSION_CONFIG, missionById, rollDailyMissions } from '../src/core/missions';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import { applyRunToMissions, claimMission, claimableCount, ensureDaily, todayStr } from '../src/meta/missions';

describe('missions core', () => {
  it('同一天任務穩定、不同天可能不同、數量固定', () => {
    const a = rollDailyMissions('2026-07-06');
    const b = rollDailyMissions('2026-07-06');
    expect(a).toEqual(b);
    expect(a.length).toBe(MISSION_CONFIG.perDay);
    for (const id of a) expect(missionById(id)).toBeTruthy();
  });

  it('todayStr 格式 YYYY-MM-DD', () => {
    expect(todayStr(Date.UTC(2026, 6, 6, 12))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('missions meta', () => {
  it('存檔升到 v9：dailyDate/dailyMissions 補齊', () => {
    const v8 = {
      version: 8, coins: 1, workshopLevels: {}, bestWave: 1, totalRuns: 0, totalKills: 0,
      updatedAt: 1, coinRate: 0, lastSeenAt: 0, playerId: 'X', cards: {}, equipped: [], cardSlots: 2,
      researchLevels: {}, activeResearch: null, ultimates: {}, tier: 1, tierMax: 1, tierBestWave: {},
    };
    const m = migrate(v8);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.dailyMissions).toEqual([]);
  });

  it('ensureDaily 首次產生、跨日重置、同日不動', () => {
    const save = defaultSave();
    expect(ensureDaily(save, '2026-07-06')).toBe(true);
    expect(save.dailyMissions.length).toBe(MISSION_CONFIG.perDay);
    // 給點進度
    save.dailyMissions[0].progress = 999;
    expect(ensureDaily(save, '2026-07-06')).toBe(false); // 同日不動
    expect(save.dailyMissions[0].progress).toBe(999);
    expect(ensureDaily(save, '2026-07-07')).toBe(true); // 跨日重置
    expect(save.dailyMissions.every((x) => x.progress === 0)).toBe(true);
  });

  it('進度累進：kills/coins/ults 累加、wave 取單場最佳', () => {
    const save = defaultSave();
    // 強制放入已知任務
    save.dailyDate = 'x';
    save.dailyMissions = [
      { id: 'kills_s', progress: 0, claimed: false },
      { id: 'wave_l', progress: 0, claimed: false },
    ];
    applyRunToMissions(save, { kills: 100, coins: 0, wave: 10, ults: 0 });
    applyRunToMissions(save, { kills: 60, coins: 0, wave: 22, ults: 0 });
    expect(save.dailyMissions[0].progress).toBe(160); // 累加
    expect(save.dailyMissions[1].progress).toBe(22); // 取最佳（22 > 10）
    applyRunToMissions(save, { kills: 0, coins: 0, wave: 18, ults: 0 });
    expect(save.dailyMissions[1].progress).toBe(22); // 較差不覆蓋
  });

  it('達標才能領獎，領一次；claimableCount 正確', () => {
    const save = defaultSave();
    save.dailyDate = 'x';
    save.dailyMissions = [{ id: 'kills_s', progress: 0, claimed: false }];
    const def = missionById('kills_s')!;
    expect(claimMission(save, 'kills_s')).toBe(0); // 未達標
    save.dailyMissions[0].progress = def.target;
    expect(claimableCount(save)).toBe(1);
    const coinsBefore = save.coins;
    expect(claimMission(save, 'kills_s')).toBe(def.reward);
    expect(save.coins).toBe(coinsBefore + def.reward);
    expect(claimMission(save, 'kills_s')).toBe(0); // 不能重複領
    expect(claimableCount(save)).toBe(0);
  });
});
