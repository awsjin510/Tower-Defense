import { describe, expect, it } from 'vitest';
import { newRun, step, buyInRunUpgrade, TICK_DT, type SimState } from '../src/core/sim';
import type { Enemy } from '../src/core/types';

function enemyAt(id: number, x: number, y: number, hp: number, maxHp = hp): Enemy {
  return {
    id, typeId: 'normal', x, y, hp, maxHp, radius: 10, speed: 0, dmg: 0,
    attackRange: 0, attackTimer: 0, cashValue: 1, coinValue: 1,
    summonEvery: 0, summonTimer: 0, burnTime: 0, burnDps: 0, burnStacks: 0,
    frostStacks: 0, frozenTime: 0, zoneTimer: 0, zoneEmpower: 1, canSplit: false,
  };
}

/** 建立一場受控戰鬥：指定 Perk、敵人，塔攻速慢到一個 tick 只開一次火 */
function rig(perks: string[], enemies: Enemy[], opts: Partial<{ range: number; crit: number; dmg: number }> = {}): SimState {
  const s = newRun({}, 1);
  s.perks = perks;
  s.stats.range = opts.range ?? 1000;
  s.stats.attackSpeed = 1;
  s.stats.critChance = opts.crit ?? 0;
  if (opts.dmg !== undefined) s.stats.damage = opts.dmg;
  s.enemies = enemies;
  s.spawnList = [];
  s.spawnIdx = 0;
  s.attackTimer = 0;
  return s;
}

describe('attack forms', () => {
  it('多重射擊：一次開火同時射出 2 發；齊射再 +1', () => {
    const far = [enemyAt(1, 260, 0, 1e9), enemyAt(2, 280, 20, 1e9), enemyAt(3, 300, -20, 1e9)];
    const s = rig(['multishot'], far);
    step(s, TICK_DT);
    expect(s.bullets.length).toBe(2); // 主目標 + 1

    const s2 = rig(['multishot', 'volley'], far.map((e) => ({ ...e })));
    step(s2, TICK_DT);
    expect(s2.bullets.length).toBe(3); // 主目標 + 2
  });

  it('穿透彈：單發子彈貫穿命中多名敵人', () => {
    const cluster = [enemyAt(1, 200, 0, 1e6), enemyAt(2, 210, 4, 1e6), enemyAt(3, 220, -4, 1e6)];
    const s = rig(['pierce'], cluster, { dmg: 50 });
    for (let t = 0; t < 40; t++) step(s, TICK_DT);
    const damaged = s.enemies.filter((e) => e.hp < e.maxHp).length;
    expect(damaged).toBeGreaterThanOrEqual(3); // 穿 2 → 命中 3 名
  });

  it('連鎖閃電：暴擊時電弧傷害附近敵人', () => {
    const cluster = [enemyAt(1, 200, 0, 1e6), enemyAt(2, 215, 6, 1e6), enemyAt(3, 230, -6, 1e6), enemyAt(4, 245, 3, 1e6)];
    const s = rig(['chainLightning'], cluster, { crit: 1, dmg: 100 });
    let arcs = 0;
    for (let t = 0; t < 40; t++) {
      step(s, TICK_DT);
      arcs += s.events.filter((e) => e.type === 'chain').length;
    }
    expect(arcs).toBeGreaterThan(0);
    // 主目標以外至少有一名被電弧波及
    const collateral = s.enemies.filter((e) => e.id !== 1 && e.hp < e.maxHp).length;
    expect(collateral).toBeGreaterThan(0);
  });

  it('軌道衛星：關閉塔射程後仍靠衛星擊殺敵人', () => {
    const s = rig(['satellite'], [enemyAt(1, 60, 0, 5)], { range: 0 });
    s.stats.damage = 100; // 衛星 70% 塔傷 = 70 > 5
    let fired = false;
    for (let t = 0; t < Math.ceil(1.4 / TICK_DT) && !fired; t++) {
      step(s, TICK_DT);
      if (s.kills >= 1) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('免費升級機率：命中時升級不扣現金', () => {
    const s = newRun({}, 1);
    s.cash = 100000;
    s.stats.freeUpgradeChance = 1; // 必定免費
    const before = s.cash;
    const lvBefore = s.inRunLevels.damage ?? 0;
    expect(buyInRunUpgrade(s, 'damage')).toBe(true);
    expect(s.cash).toBe(before); // 沒扣錢
    expect(s.inRunLevels.damage).toBe(lvBefore + 1); // 但等級有升
  });
});
