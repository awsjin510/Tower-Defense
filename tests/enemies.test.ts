import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT, type SimState } from '../src/core/sim';
import { ENEMY_TYPES } from '../src/core/waves';
import type { Enemy, SimEvent } from '../src/core/types';

function makeTestEnemy(s: SimState, typeId: string, x: number, y: number, over: Partial<Enemy> = {}): Enemy {
  const def = ENEMY_TYPES.find((t) => t.id === typeId)!;
  return {
    id: 9000 + s.enemies.length,
    typeId,
    x,
    y,
    hp: 1e9,
    maxHp: 1e9,
    speed: 60,
    dmg: 5,
    cashValue: 1,
    coinValue: 0.1,
    radius: def.radius,
    attackTimer: 0,
    attackRange: def.attackRange ?? 0,
    summonEvery: def.summonEvery ?? 0,
    summonTimer: def.summonEvery ?? 0,
    ...over,
  };
}

/** 收集接下來 seconds 秒內的所有事件 */
function collectEvents(s: SimState, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  const ticks = Math.floor(seconds / TICK_DT);
  for (let i = 0; i < ticks && !s.over; i++) {
    step(s, TICK_DT);
    out.push(...s.events);
  }
  return out;
}

/** 塔不攻擊、不出波的乾淨場景，只留我們手動放的敵人 */
function emptyArena(seed: number): SimState {
  const s = newRun({}, seed);
  s.spawnList = [];
  s.stats.damage = 0;
  s.stats.maxHealth = 1e9;
  s.towerHp = 1e9;
  // 卡住波次結束判定：留一個不會動、打不到塔的哨兵可省略——
  // spawnList 空且敵人清空時會進下一波，但下一波也要時間，測試秒數內不影響斷言。
  return s;
}

describe('ranged enemy (sniper)', () => {
  it('走到 attackRange 就停下，不貼塔', () => {
    const s = emptyArena(1);
    const def = ENEMY_TYPES.find((t) => t.id === 'sniper')!;
    const e = makeTestEnemy(s, 'sniper', 300, 0);
    s.enemies.push(e);
    collectEvents(s, 10);
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(def.attackRange!, 1);
  });

  it('停在射程外攻擊塔並發出 enemyShot 事件', () => {
    const s = emptyArena(2);
    const e = makeTestEnemy(s, 'sniper', 150, 0);
    s.enemies.push(e);
    const hpBefore = s.towerHp;
    const events = collectEvents(s, 2.5);
    expect(events.some((ev) => ev.type === 'enemyShot')).toBe(true);
    expect(events.some((ev) => ev.type === 'towerHit')).toBe(true);
    expect(s.towerHp).toBeLessThan(hpBefore);
  });
});

describe('boss summon', () => {
  it('每 summonEvery 秒在腳下召喚小兵並發出 summon 事件', () => {
    const s = emptyArena(3);
    const def = ENEMY_TYPES.find((t) => t.id === 'boss')!;
    expect(def.summonEvery).toBeGreaterThan(0);
    const boss = makeTestEnemy(s, 'boss', 250, 0, { speed: 0 });
    s.enemies.push(boss);
    const before = s.enemies.length;
    const events = collectEvents(s, def.summonEvery! + 0.5);
    expect(events.some((ev) => ev.type === 'summon')).toBe(true);
    expect(s.enemies.length).toBe(before + (def.summonCount ?? 1));
    // 小兵出生在 Boss 附近而不是場邊
    const minion = s.enemies[s.enemies.length - 1];
    expect(Math.hypot(minion.x - boss.x, minion.y - boss.y)).toBeLessThan(boss.radius + 20);
  });

  it('一般敵人不會召喚', () => {
    const s = emptyArena(4);
    s.enemies.push(makeTestEnemy(s, 'normal', 250, 0, { speed: 0 }));
    const events = collectEvents(s, 8);
    expect(events.some((ev) => ev.type === 'summon')).toBe(false);
  });
});
