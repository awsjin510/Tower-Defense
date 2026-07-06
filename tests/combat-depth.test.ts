import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT } from '../src/core/sim';
import type { Enemy } from '../src/core/types';

function enemy(id: number, hp = 100, x = 40, y = 0): Enemy {
  return {
    id, typeId: 'normal', x, y, hp, maxHp: hp, speed: 0, dmg: 0,
    cashValue: 0, coinValue: 0, radius: 9, attackTimer: 999, attackRange: 0,
    summonEvery: 0, summonTimer: 0, burnDps: 0, burnTime: 0, burnStacks: 0,
    frostStacks: 0, frozenTime: 0, zoneTimer: 999, zoneEmpower: 1, canSplit: true,
  };
}

function quietRun(wave = 1) {
  const s = newRun({}, 123);
  s.wave = wave;
  s.spawnIdx = s.spawnList.length;
  s.interWaveTimer = 999;
  s.attackTimer = 999;
  return s;
}

function hit(s: ReturnType<typeof quietRun>, target: Enemy, dmg = 10, crit = false): void {
  s.bullets.push({ x: target.x, y: target.y, targetId: target.id, speed: 460, dmg, crit });
  step(s, TICK_DT);
}

describe('rule perk builds', () => {
  it('燃燒彈頭疊燃燒，揮發燃料讓爆擊追加兩層', () => {
    const s = quietRun();
    s.perks = ['incendiary', 'volatileFuel'];
    const e = enemy(1, 1000);
    s.enemies = [e];
    hit(s, e, 20, true);
    expect(e.burnStacks).toBe(2);
    expect(e.burnDps).toBeGreaterThan(20 * 0.18);
    expect(e.burnTime).toBeGreaterThan(2.9);
  });

  it('野火會把死亡敵人的燃燒傳給附近敵人', () => {
    const s = quietRun();
    s.perks = ['incendiary', 'wildfire'];
    const dying = enemy(1, 1, 40, 0);
    const nearby = enemy(2, 100, 55, 0);
    dying.burnDps = 100;
    dying.burnTime = 2;
    dying.burnStacks = 3;
    s.enemies = [dying, nearby];
    step(s, TICK_DT);
    expect(s.enemies).not.toContain(dying);
    expect(nearby.burnStacks).toBeGreaterThan(0);
  });

  it('低溫彈藥三層凍結，脆化增加傷害', () => {
    const base = quietRun();
    base.perks = ['cryoRounds'];
    const normal = enemy(1, 1000);
    base.enemies = [normal];
    hit(base, normal, 20);
    hit(base, normal, 20);
    hit(base, normal, 20);
    expect(normal.frozenTime).toBeGreaterThan(1);

    const brittle = quietRun();
    brittle.perks = ['brittle'];
    const frozen = enemy(2, 1000);
    frozen.frozenTime = 2;
    brittle.enemies = [frozen];
    hit(brittle, frozen, 20);
    expect(1000 - frozen.hp).toBeCloseTo(30);
  });

  it('碎冰在凍結敵人死亡時傷害附近敵人', () => {
    const s = quietRun();
    s.perks = ['shatter'];
    const dying = enemy(1, 1, 40, 0);
    const nearby = enemy(2, 100, 55, 0);
    dying.frozenTime = 2;
    dying.burnDps = 100;
    dying.burnTime = 2;
    s.enemies = [dying, nearby];
    step(s, TICK_DT);
    expect(nearby.hp).toBeCloseTo(100 - s.stats.damage * 0.8);
  });
});

describe('zone mechanics', () => {
  it('翠綠曠野會把敵人分裂為不再分裂的幼體', () => {
    const s = quietRun(6);
    s.rng = () => 0;
    const e = enemy(1, 1);
    s.enemies = [e];
    hit(s, e, 10);
    expect(s.enemies).toHaveLength(2);
    expect(s.enemies.every((child) => !child.canSplit && child.hp < child.maxHp * 1.01)).toBe(true);
  });

  it('寒冰侵蝕隨時間累積，擊殺可回暖', () => {
    const s = quietRun(11);
    step(s, 5);
    expect(s.zoneMeter).toBeGreaterThan(0);
    const before = s.zoneMeter;
    const e = enemy(1, 1);
    s.enemies = [e];
    hit(s, e, 10);
    expect(s.zoneMeter).toBeLessThan(before);
  });

  it('熔岩脈衝同時震傷塔並點燃敵人', () => {
    const s = quietRun(21);
    const e = enemy(1, 100);
    s.enemies = [e];
    s.zonePulseTimer = 0;
    const hp = s.towerHp;
    step(s, TICK_DT);
    expect(s.towerHp).toBeLessThan(hp);
    expect(e.burnTime).toBeGreaterThan(0);
    expect(s.events.some((event) => event.type === 'zonePulse')).toBe(true);
  });

  it('虛空敵人會週期性向塔瞬移', () => {
    const s = quietRun(31);
    const e = enemy(1, 100, 200, 0);
    e.zoneTimer = 0;
    s.enemies = [e];
    step(s, TICK_DT);
    expect(e.x).toBeLessThan(200);
  });
});
