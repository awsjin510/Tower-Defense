import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT, type SimState } from '../src/core/sim';
import { ENEMY_TYPES, waveComposition } from '../src/core/waves';
import { mulberry32 } from '../src/core/rng';
import type { Enemy } from '../src/core/types';

/** 建立一隻完整欄位的測試敵人（避開零散 literal 缺欄位問題） */
function mkEnemy(s: SimState, typeId: string, over: Partial<Enemy> = {}): Enemy {
  const def = ENEMY_TYPES.find((t) => t.id === typeId)!;
  return {
    id: s.nextEnemyId++,
    typeId,
    x: 40,
    y: 0,
    hp: 100,
    maxHp: 100,
    speed: 0,
    dmg: 5,
    cashValue: 1,
    coinValue: 0.1,
    radius: def.radius,
    attackTimer: 0,
    attackRange: def.attackRange ?? 0,
    summonEvery: 0,
    summonTimer: 0,
    burnDps: 0,
    burnTime: 0,
    burnStacks: 0,
    frostStacks: 0,
    frozenTime: 0,
    zoneTimer: 999,
    zoneEmpower: 1,
    canSplit: false,
    ...over,
  };
}

/** 塔設為不死、關閉出怪，只留手動放的敵人 */
function arena(seed: number): SimState {
  const s = newRun({}, seed);
  s.spawnList = [];
  s.stats.maxHealth = 1e12;
  s.towerHp = 1e12;
  s.stats.damage = 0; // 塔不主動打，方便觀察敵人行為
  return s;
}

describe('new enemy data', () => {
  it('三種新敵人存在且欄位正確', () => {
    const byId = (id: string) => ENEMY_TYPES.find((t) => t.id === id);
    expect(byId('splitter')?.splitInto).toBeGreaterThan(0);
    expect(byId('vampire')?.lifesteal).toBeGreaterThan(0);
    expect(byId('protector')?.auraHeal).toBeGreaterThan(0);
    // 稀有單位權重低於一般兵
    expect(byId('protector')!.weight!).toBeLessThan(1);
  });

  it('加權出怪：權重低的護盾兵佔比明顯低於一般兵', () => {
    const rng = mulberry32(7);
    const counts: Record<string, number> = {};
    for (let w = 0; w < 400; w++) for (const id of waveComposition(20, rng)) counts[id] = (counts[id] ?? 0) + 1;
    expect((counts['protector'] ?? 0)).toBeLessThan(counts['normal'] ?? 1);
  });
});

describe('splitter', () => {
  it('死亡時分裂出子體，子體不再分裂（終止）', () => {
    const s = arena(1);
    const def = ENEMY_TYPES.find((t) => t.id === 'splitter')!;
    const sp = mkEnemy(s, 'splitter', { hp: 1 });
    s.enemies.push(sp);
    // 用一發必殺子彈擊殺分裂體
    s.bullets.push({ x: 40, y: 0, targetId: sp.id, speed: 460, dmg: 999, crit: false });
    step(s, TICK_DT);
    const children = s.enemies.filter((e) => e.typeId === (def.splitType ?? 'fast'));
    expect(children.length).toBe(def.splitInto);
    // 擊殺一隻子體不應再產生孫體
    const before = s.enemies.length;
    const child = children[0];
    child.hp = 1;
    s.bullets.push({ x: child.x, y: child.y, targetId: child.id, speed: 460, dmg: 999, crit: false });
    step(s, TICK_DT);
    expect(s.enemies.length).toBeLessThan(before); // 淨減少，沒有無限分裂
  });
});

describe('vampire', () => {
  it('攻擊塔時回復自身血量', () => {
    const s = arena(2);
    const v = mkEnemy(s, 'vampire', { x: 20, y: 0, hp: 40, maxHp: 100, dmg: 5, attackTimer: 0 });
    s.enemies.push(v);
    // 貼近塔、推進到攻擊觸發
    for (let i = 0; i < 40; i++) step(s, TICK_DT);
    expect(v.hp).toBeGreaterThan(40); // 吸血後高於初始
  });
});

describe('protector', () => {
  it('治療範圍內受傷的同伴', () => {
    const s = arena(3);
    const p = mkEnemy(s, 'protector', { x: 0, y: 200, speed: 0 });
    const ally = mkEnemy(s, 'normal', { x: 20, y: 200, hp: 50, maxHp: 100, speed: 0 });
    s.enemies.push(p, ally);
    const before = ally.hp;
    for (let i = 0; i < 30; i++) step(s, TICK_DT);
    expect(ally.hp).toBeGreaterThan(before);
  });

  it('範圍外的同伴不受治療', () => {
    const s = arena(4);
    const p = mkEnemy(s, 'protector', { x: 0, y: 250, speed: 0 });
    const far = mkEnemy(s, 'normal', { x: 320, y: -250, hp: 50, maxHp: 100, speed: 0 });
    s.enemies.push(p, far);
    const before = far.hp;
    for (let i = 0; i < 30; i++) step(s, TICK_DT);
    expect(far.hp).toBe(before);
  });
});
