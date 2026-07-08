import { describe, expect, it } from 'vitest';
import { applySave, defaultSave, ensurePlayerId, mergeSaveProgress, migrate, newPlayerId, SAVE_VERSION } from '../src/meta/save';
import { validSave } from '../worker/index';
import { buyWorkshopUpgrade, settleRun } from '../src/meta/workshop';

describe('save', () => {
  it('損壞的存檔回退到預設值', () => {
    expect(migrate(null)).toEqual(defaultSave());
    expect(migrate('garbage')).toEqual(defaultSave());
  });

  it('帳號代碼：newPlayerId 產生 16 位大寫十六進位', () => {
    const id = newPlayerId();
    expect(id).toMatch(/^[0-9A-F]{16}$/);
    expect(newPlayerId()).not.toBe(id); // 幾乎不可能相同
  });

  it('ensurePlayerId 首次產生、之後穩定不變', () => {
    const save = defaultSave();
    expect(save.playerId).toBe('');
    const id = ensurePlayerId(save);
    expect(id).toMatch(/^[0-9A-F]{16}$/);
    expect(save.playerId).toBe(id);
    expect(ensurePlayerId(save)).toBe(id); // 不覆寫既有代碼
  });

  it('缺欄位的舊存檔補齊並升到最新版本', () => {
    const migrated = migrate({ version: 0, coins: 50 });
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.coins).toBe(50);
    expect(migrated.workshopLevels).toEqual({});
    expect(migrated.updatedAt).toBe(0);
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

  it('套用雲端存檔時保留原物件參考', () => {
    const local = defaultSave();
    const originalLevels = local.workshopLevels;
    const cloud = { ...defaultSave(), coins: 88, workshopLevels: { ws_damage: 3 }, updatedAt: 123 };
    applySave(local, cloud);
    expect(local.coins).toBe(88);
    expect(local.workshopLevels).toEqual({ ws_damage: 3 });
    expect(local.workshopLevels).not.toBe(originalLevels);
  });

  it('套用雲端存檔時保留五組卡片配置', () => {
    const local = defaultSave();
    const cloud = defaultSave();
    cloud.cardPresets = [['as'], ['hp'], ['coin'], ['range'], ['crit']];
    applySave(local, cloud);
    expect(local.cardPresets).toEqual(cloud.cardPresets);
  });

  it('雲端 API 接受遊戲實際產生的小數金幣', () => {
    const save = { ...defaultSave(), coins: 23.2, updatedAt: Date.now() };
    expect(validSave(save)).toBe(true);
  });

  it('跨裝置合併保留較新的配置與兩邊較高的永久進度', () => {
    const phone = { ...defaultSave(), updatedAt: 200, coins: 12.5, bestWave: 30, workshopLevels: { ws_damage: 2 }, cards: { crit: 2 } };
    const desktop = { ...defaultSave(), updatedAt: 100, coins: 99, bestWave: 45, workshopLevels: { ws_damage: 5 }, cards: { coin: 3 } };
    const merged = mergeSaveProgress(phone, desktop);
    expect(merged.coins).toBe(12.5); // 可花費值以最近裝置為準，避免回復已花掉的貨幣
    expect(merged.bestWave).toBe(45);
    expect(merged.workshopLevels.ws_damage).toBe(5);
    expect(merged.cards).toMatchObject({ crit: 2, coin: 3 });
  });
});
