import { describe, expect, it } from 'vitest';
import { autoplayRun, greedySpendWorkshop } from './harness';
import { defaultSave } from '../src/meta/save';
import { settleRun } from '../src/meta/workshop';

/**
 * 平衡守門測試（規劃書第 4 節的量化目標）：
 * 用貪婪 AI 模擬真實玩家的多場進度曲線。改動數值表後跑這裡，
 * 紅了就代表曲線偏離設計目標。
 */
describe('balance', () => {
  it('首場（無工坊）死亡波數落在 10~30、時長 3~15 分鐘', () => {
    const waves: number[] = [];
    const times: number[] = [];
    for (const seed of [1, 2, 3]) {
      const s = autoplayRun({}, seed);
      expect(s.over).toBe(true);
      waves.push(s.wave);
      times.push(s.time);
    }
    const avgWave = waves.reduce((a, b) => a + b) / waves.length;
    const avgTime = times.reduce((a, b) => a + b) / times.length;
    expect(avgWave).toBeGreaterThanOrEqual(10);
    expect(avgWave).toBeLessThanOrEqual(30);
    expect(avgTime).toBeGreaterThanOrEqual(180);
    expect(avgTime).toBeLessThanOrEqual(900);
  });

  it('工坊投資讓進度成長：累積工坊後，同一組種子的平均波數 >= 全新存檔 1.3 倍', () => {
    // 先連打 6 場累積工坊等級（每場結算後貪婪買工坊）
    const save = defaultSave();
    const waves: number[] = [];
    for (let i = 0; i < 6; i++) {
      const s = autoplayRun(save.workshopLevels, 100 + i);
      settleRun(save, { wave: s.wave, coinsEarned: s.coinsEarned, kills: s.kills });
      greedySpendWorkshop(save);
      waves.push(s.wave);
    }
    expect(save.bestWave).toBe(Math.max(...waves));

    // 用同一組種子跑「全新存檔」與「已投資工坊」各一輪，取平均以抵銷 Perk 隨機性。
    // Perk 三選一的高變異會讓單場波數大幅波動，用種子面板平均才能穩定量測工坊成長。
    const panel = [300, 301, 302, 303, 304, 305];
    const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const fresh = avg(panel.map((seed) => autoplayRun({}, seed).wave));
    const invested = avg(panel.map((seed) => autoplayRun(save.workshopLevels, seed).wave));
    expect(invested).toBeGreaterThanOrEqual(fresh * 1.3);
  }, 120_000);
});
