import { describe, expect, it } from 'vitest';
import { activateUltimate, newRun, step, TICK_DT } from '../src/core/sim';
import {
  ULTIMATES,
  isUltimateMaxed,
  resolveUltimate,
  ultimateById,
  ultimateCooldown,
  ultimateUpgradeCost,
  ultimateValue,
} from '../src/core/ultimates';
import type { Enemy } from '../src/core/types';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import {
  buyUltimateUpgrade,
  resolvedUltimates,
  syncUltimateUnlocks,
  ultimateLevel,
  ultimateUpgradePrice,
} from '../src/meta/ultimates';

function mkEnemy(id: number, x: number, hp: number, typeId = 'normal'): Enemy {
  return {
    id, typeId, x, y: 0, hp, maxHp: hp, speed: 0, dmg: 0,
    cashValue: 5, coinValue: 1, radius: 9, attackTimer: 0, attackRange: 0, summonEvery: 0, summonTimer: 0,
  };
}

describe('ultimates data & formulas', () => {
  it('資料健全：黃金塔=coinBuff、黑洞=nuke，成本/威力隨等級遞增，冷卻有下限', () => {
    expect(ULTIMATES.some((u) => u.kind === 'coinBuff')).toBe(true);
    expect(ULTIMATES.some((u) => u.kind === 'nuke')).toBe(true);
    for (const def of ULTIMATES) {
      expect(ultimateUpgradeCost(def, 2)).toBeGreaterThan(ultimateUpgradeCost(def, 1));
      expect(ultimateValue(def, 2)).toBeGreaterThan(ultimateValue(def, 1));
      // 冷卻隨等級下降但不低於下限
      expect(ultimateCooldown(def, def.maxLevel)).toBeGreaterThanOrEqual(def.minCooldown);
      expect(ultimateCooldown(def, def.maxLevel)).toBeLessThanOrEqual(ultimateCooldown(def, 1));
    }
  });
});

describe('ultimates meta', () => {
  it('存檔升到 v7：ultimates 補齊', () => {
    const v6 = {
      version: 6, coins: 1, workshopLevels: {}, bestWave: 1, totalRuns: 0, totalKills: 0,
      updatedAt: 1, coinRate: 0, lastSeenAt: 0, playerId: 'X', cards: {}, equipped: [], cardSlots: 2,
      researchLevels: {}, activeResearch: null,
    };
    const m = migrate(v6);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.ultimates).toEqual({});
  });

  it('里程碑解鎖：bestWave 達門檻給 1 級，不覆寫已升級', () => {
    const save = defaultSave();
    save.bestWave = 0;
    expect(syncUltimateUnlocks(save)).toEqual([]); // golden 需 wave 5
    save.bestWave = 999;
    const unlocked = syncUltimateUnlocks(save);
    expect(unlocked.length).toBe(ULTIMATES.length);
    for (const def of ULTIMATES) expect(ultimateLevel(save, def.id)).toBe(1);
    save.ultimates[ULTIMATES[0].id] = 4;
    syncUltimateUnlocks(save);
    expect(ultimateLevel(save, ULTIMATES[0].id)).toBe(4);
  });

  it('升級花金幣、達上限停止', () => {
    const save = defaultSave();
    save.bestWave = 999;
    syncUltimateUnlocks(save);
    const id = ULTIMATES[0].id;
    const def = ultimateById(id)!;
    save.coins = 0;
    expect(buyUltimateUpgrade(save, id)).toBe(false);
    save.coins = 1e12;
    let guard = 0;
    while (!isUltimateMaxed(def, ultimateLevel(save, id)) && guard++ < 50) {
      expect(buyUltimateUpgrade(save, id)).toBe(true);
    }
    expect(ultimateLevel(save, id)).toBe(def.maxLevel);
    expect(ultimateUpgradePrice(save, id)).toBeNull();
    expect(buyUltimateUpgrade(save, id)).toBe(false);
  });

  it('resolvedUltimates 只回傳已解鎖者', () => {
    const save = defaultSave();
    save.bestWave = 5; // 只解鎖 golden
    syncUltimateUnlocks(save);
    const list = resolvedUltimates(save);
    expect(list.some((u) => u.id === 'golden')).toBe(true);
    expect(list.some((u) => u.id === 'blackhole')).toBe(false);
  });
});

describe('ultimates in sim', () => {
  it('黑洞：瞬間對全場敵人造成塔傷倍率傷害', () => {
    const bh = resolveUltimate(ultimateById('blackhole')!, 1);
    const s = newRun({}, 1, undefined, {}, [bh]);
    s.enemies.push(mkEnemy(1, 40, 1e9), mkEnemy(2, 60, 1e9), mkEnemy(3, 80, 1e9));
    expect(activateUltimate(s, 'blackhole')).toBe(true);
    const expected = s.stats.damage * bh.damageMult;
    for (const e of s.enemies) expect(e.maxHp - e.hp).toBeCloseTo(expected);
    // 冷卻啟動 → 不能連按
    expect(activateUltimate(s, 'blackhole')).toBe(false);
    expect(s.ultCooldowns['blackhole']).toBeCloseTo(bh.cooldown);
  });

  it('冷卻隨時間歸零後可再施放', () => {
    const bh = resolveUltimate(ultimateById('blackhole')!, 1);
    const s = newRun({}, 1, undefined, {}, [bh]);
    // 讓塔不死、確保模擬不因塔亡而凍結
    s.stats.maxHealth = 1e12;
    s.towerHp = 1e12;
    s.enemies.push(mkEnemy(1, 40, 1e9));
    activateUltimate(s, 'blackhole');
    expect(s.ultCooldowns['blackhole']).toBeCloseTo(bh.cooldown);
    // 推進到冷卻結束（過程中若跳 Perk 即時清掉以免暫停）
    const ticks = Math.ceil(bh.cooldown / TICK_DT) + 5;
    for (let i = 0; i < ticks; i++) {
      step(s, TICK_DT);
      if (s.pendingPerks) { s.perks.push(s.pendingPerks[0]); s.pendingPerks = null; }
    }
    expect(s.ultCooldowns['blackhole']).toBe(0);
    s.enemies.push(mkEnemy(99, 40, 1e9));
    expect(activateUltimate(s, 'blackhole')).toBe(true);
  });

  it('黃金塔：限時內擊殺金幣加倍，效果到期後恢復', () => {
    const gold = resolveUltimate(ultimateById('golden')!, 1);
    const killWith = (activate: boolean): number => {
      const s = newRun({}, 1, undefined, {}, [gold]);
      if (activate) activateUltimate(s, 'golden');
      s.enemies.push(mkEnemy(1, 40, 1));
      s.bullets.push({ x: 40, y: 0, targetId: 1, speed: 460, dmg: 999, crit: false });
      const before = s.coinsEarned;
      step(s, TICK_DT);
      return s.coinsEarned - before;
    };
    const plain = killWith(false);
    const buffed = killWith(true);
    expect(buffed).toBeCloseTo(plain * gold.coinMult);

    // 到期後倍率消失
    const s = newRun({}, 1, undefined, {}, [gold]);
    activateUltimate(s, 'golden');
    const ticks = Math.ceil(gold.duration / TICK_DT) + 2;
    for (let i = 0; i < ticks; i++) step(s, TICK_DT);
    expect(s.ultActive.length).toBe(0);
  });

  it('未持有終極武器時 activate 無效、newRun 行為與無終極一致（確定性）', () => {
    const a = newRun({}, 909);
    const b = newRun({}, 909, undefined, {}, []);
    expect(activateUltimate(a, 'golden')).toBe(false);
    for (let i = 0; i < 300; i++) {
      step(a, TICK_DT);
      step(b, TICK_DT);
      if (a.pendingPerks) { a.perks.push(a.pendingPerks[0]); a.pendingPerks = null; }
      if (b.pendingPerks) { b.perks.push(b.pendingPerks[0]); b.pendingPerks = null; }
    }
    expect(a.cash).toBe(b.cash);
    expect(a.wave).toBe(b.wave);
  });
});
