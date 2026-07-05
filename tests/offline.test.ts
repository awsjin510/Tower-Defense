import { describe, expect, it } from 'vitest';
import {
  offlineCoins,
  runCoinRate,
  OFFLINE_CAP_HOURS,
  OFFLINE_EFFICIENCY,
  OFFLINE_MIN_SECONDS,
} from '../src/core/offline';
import { defaultSave, migrate } from '../src/meta/save';
import { settleRun } from '../src/meta/workshop';

describe('offline', () => {
  it('收益 = 每秒產出 × 離線秒數 × 折扣', () => {
    expect(offlineCoins(2, 3600)).toBeCloseTo(2 * 3600 * OFFLINE_EFFICIENCY);
  });

  it('離線太短或無產出紀錄不結算', () => {
    expect(offlineCoins(2, OFFLINE_MIN_SECONDS - 1)).toBe(0);
    expect(offlineCoins(0, 3600)).toBe(0);
    expect(offlineCoins(2, -5)).toBe(0);
    expect(offlineCoins(2, NaN)).toBe(0);
  });

  it('離線時數有硬上限（陷阱 3：不能比在線划算）', () => {
    const capped = offlineCoins(1, OFFLINE_CAP_HOURS * 3600);
    expect(offlineCoins(1, OFFLINE_CAP_HOURS * 3600 * 10)).toBe(capped);
  });

  it('runCoinRate 邊界', () => {
    expect(runCoinRate(120, 60)).toBe(2);
    expect(runCoinRate(0, 60)).toBe(0);
    expect(runCoinRate(10, 0)).toBe(0);
  });

  it('settleRun 記錄歷史最佳每秒產出', () => {
    const save = defaultSave();
    settleRun(save, { wave: 10, coinsEarned: 60, kills: 5, timeSec: 60 });
    expect(save.coinRate).toBe(1);
    settleRun(save, { wave: 12, coinsEarned: 30, kills: 5, timeSec: 60 });
    expect(save.coinRate).toBe(1); // 較差的一場不會拉低
    settleRun(save, { wave: 15, coinsEarned: 180, kills: 5, timeSec: 60 });
    expect(save.coinRate).toBe(3);
  });

  it('v2 存檔遷移到 v3：補 coinRate/lastSeenAt，首次不結算離線', () => {
    const v2 = { version: 2, coins: 50, workshopLevels: { damage: 3 }, bestWave: 20, totalRuns: 4, totalKills: 99, updatedAt: 123 };
    const migrated = migrate(v2);
    expect(migrated.version).toBe(3);
    expect(migrated.coins).toBe(50);
    expect(migrated.coinRate).toBe(0);
    expect(migrated.lastSeenAt).toBe(0);
    expect(offlineCoins(migrated.coinRate, 99999)).toBe(0);
  });
});
