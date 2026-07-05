import { describe, expect, it } from 'vitest';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import { buyWorkshopUpgrade, settleRun } from '../src/meta/workshop';

describe('save', () => {
  it('損壞的存檔回退到預設值', () => {
    expect(migrate(null)).toEqual(defaultSave());
    expect(migrate('garbage')).toEqual(defaultSave());
  });

  it('缺欄位的舊存檔補齊並升到最新版本', () => {
    const migrated = migrate({ version: 0, coins: 50 });
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.coins).toBe(50);
    expect(migrated.workshopLevels).toEqual({});
  });

  it('工坊購買扣金幣、升等級、錢不夠拒買', () => {
    const save = defaultSave();
    save.coins = 100;
    expect(buyWorkshopUpgrade(save, 'ws_damage')).toBe(true);
    expect(save.workshopLevels['ws_damage']).toBe(1);
    expect(save.coins).toBeLessThan(100);
    save.coins = 0;
    expect(buyWorkshopUpgrade(save, 'ws_damage')).toBe(false);
  });

  it('結算寫入永久存檔', () => {
    const save = defaultSave();
    settleRun(save, { wave: 15, coinsEarned: 42, kills: 100 });
    expect(save.coins).toBe(42);
    expect(save.bestWave).toBe(15);
    expect(save.totalRuns).toBe(1);
    settleRun(save, { wave: 10, coinsEarned: 8, kills: 50 });
    expect(save.bestWave).toBe(15);
    expect(save.totalKills).toBe(150);
  });
});
