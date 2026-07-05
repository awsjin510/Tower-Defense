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

  it('連打 5 場（每場結算後貪婪買工坊）：波數要成長、第 5 場 >= 首場 1.3 倍', () => {
    const save = defaultSave();
    const waves: number[] = [];
    for (let i = 0; i < 5; i++) {
      const s = autoplayRun(save.workshopLevels, 100 + i);
      settleRun(save, { wave: s.wave, coinsEarned: s.coinsEarned, kills: s.kills });
      greedySpendWorkshop(save);
      waves.push(s.wave);
    }
    expect(waves[4]).toBeGreaterThanOrEqual(Math.ceil(waves[0] * 1.3));
    expect(save.bestWave).toBe(Math.max(...waves));
  }, 120_000);
});
