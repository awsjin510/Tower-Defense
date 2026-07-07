import { describe, expect, it } from 'vitest';
import { CARD_CONFIG, CARDS, CARD_SETS, buildRunMods } from '../src/core/cards';
import { newRun, selectTarget, step, TICK_DT } from '../src/core/sim';
import { IN_RUN_UPGRADES, nextMilestone } from '../src/core/stats';
import type { Enemy, TargetPriority } from '../src/core/types';
import { applyPreset, savePreset, syncCardUnlocks } from '../src/meta/cards';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';

function enemy(id: number, typeId: string, x: number, hp: number, attackRange = 0): Enemy {
  return {
    id, typeId, x, y: 0, hp, maxHp: hp, speed: 0, dmg: 0, cashValue: 0, coinValue: 0,
    radius: 9, attackTimer: 999, attackRange, summonEvery: 0, summonTimer: 0,
    burnDps: 0, burnTime: 0, burnStacks: 0, frostStacks: 0, frozenTime: 0,
    zoneTimer: 999, zoneEmpower: 1, canSplit: false,
  };
}

describe('stage 1 upgrades and targeting', () => {
  it('場內升級由 9 項擴充為 18 項，三類都有新選擇', () => {
    expect(IN_RUN_UPGRADES).toHaveLength(18);
    for (const id of ['projectileSpeed', 'armorPen', 'eliteDamage', 'armor', 'damageReduction', 'energyShield', 'interestRate', 'coinBonus', 'elementalPower']) {
      expect(IN_RUN_UPGRADES.some((u) => u.id === id)).toBe(true);
    }
  });

  it('六種索敵策略會選到正確目標', () => {
    const units = [enemy(1, 'normal', 40, 40), enemy(2, 'tank', 100, 300), enemy(3, 'sniper', 70, 80, 150)];
    const pick = (targetPriority: TargetPriority) => selectTarget({ targetPriority }, units)?.id;
    expect(pick('closest')).toBe(1);
    expect(pick('farthest')).toBe(2);
    expect(pick('highHp')).toBe(2);
    expect(pick('lowHp')).toBe(1);
    expect(pick('elite')).toBe(3); // 精英同優先時取最近者
    expect(pick('ranged')).toBe(3);
  });

  it('里程碑資料可查詢，傷害 Lv.20 會造成範圍傷害', () => {
    expect(nextMilestone('damage', 19)?.level).toBe(20);
    expect(nextMilestone('damage', 20)).toBeUndefined();
    const s = newRun({}, 7);
    s.spawnIdx = s.spawnList.length; s.interWaveTimer = 999; s.attackTimer = 999;
    s.inRunLevels.damage = 20;
    const main = enemy(1, 'normal', 40, 1000);
    const near = enemy(2, 'normal', 55, 1000);
    s.enemies = [main, near];
    s.bullets.push({ x: 40, y: 0, targetId: 1, speed: 460, dmg: 10, crit: false });
    step(s, TICK_DT);
    expect(near.hp).toBeLessThan(1000);
  });
});

describe('stage 2 cards and presets', () => {
  it('卡片擴充到 36 張、套裝擴充到 10 套、槽位上限 8', () => {
    expect(CARDS).toHaveLength(36);
    expect(CARD_SETS).toHaveLength(10);
    expect(CARD_CONFIG.maxSlots).toBe(8);
    for (const id of ['armorplate', 'barrier', 'penetrator', 'repulsor', 'elemental', 'elitehunter', 'compound', 'salvage', 'thermalcore', 'glacialcore']) {
      expect(CARDS.some((c) => c.id === id)).toBe(true);
    }
  });

  it('新卡效果與五套新套裝會進入 RunMods', () => {
    const mods = buildRunMods(['armorplate', 'barrier', 'hp', 'thermalcore', 'elemental'], () => 3);
    expect(mods.statMods.some((m) => m.stat === 'armor')).toBe(true);
    expect(mods.statMods.some((m) => m.stat === 'energyShield')).toBe(true);
    expect(mods.startPerks).toContain('incendiary');
    expect(mods.startPerks).toContain('volatileFuel');
    expect(mods.statMods.some((m) => m.stat === 'damageReduction')).toBe(true);
  });

  it('舊存檔升至 v10 並可儲存／套用三套配置', () => {
    const migrated = migrate({ version: 9, cards: {}, equipped: [] });
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.cardPresets).toEqual([[], [], [], [], []]);
    const save = defaultSave();
    save.bestWave = 999; syncCardUnlocks(save); save.cardSlots = 8;
    save.equipped = ['as', 'hp', 'coin'];
    expect(savePreset(save, 1)).toBe(true);
    save.equipped = [];
    expect(applyPreset(save, 1)).toBe(true);
    expect(save.equipped).toEqual(['as', 'hp', 'coin']);
  });
});
