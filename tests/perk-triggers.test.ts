import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT, type SimState } from '../src/core/sim';
import type { Enemy } from '../src/core/types';

function makeTestEnemy(id: number, hp: number, maxHp: number, x = 40): Enemy {
  return {
    id,
    typeId: 'normal',
    x,
    y: 0,
    hp,
    maxHp,
    radius: 10,
    speed: 0,
    dmg: 0,
    attackRange: 0,
    attackTimer: 0,
    cashValue: 1,
    coinValue: 1,
    summonEvery: 0,
    summonTimer: 0,
    burnTime: 0,
    burnDps: 0,
    burnStacks: 0,
    frostStacks: 0,
    frozenTime: 0,
    zoneTimer: 0,
    zoneEmpower: 1,
    canSplit: false,
  };
}

/** 給塔足夠攻速與傷害，讓子彈很快命中場上唯一的敵人 */
function riggedRun(perks: string[], enemyHp: number, enemyMax: number): SimState {
  const s = newRun({}, 1);
  s.perks = perks;
  s.stats.range = 1000;
  s.stats.attackSpeed = 10;
  s.stats.critChance = 0;
  s.enemies = [makeTestEnemy(999, enemyHp, enemyMax)];
  s.spawnList = [];
  s.spawnIdx = 0;
  return s;
}

describe('perk triggers', () => {
  it('處決者：血量落入門檻的敵人被直接了結（即使子彈傷害不足以擊殺）', () => {
    // 巨量血量、極低塔傷 → 若無處決不可能一發打死；血量已在 12% 門檻內
    const s = riggedRun(['execute'], 1000 * 0.11, 1000);
    s.stats.damage = 1; // 一發只扣 1，遠不足以打死 110 血
    for (let t = 0; t < 60 && s.enemies.length > 0; t++) step(s, TICK_DT);
    expect(s.enemies.length).toBe(0);
    expect(s.kills).toBe(1);
  });

  it('處決者：血量高於門檻時不觸發', () => {
    const s = riggedRun(['execute'], 1000 * 0.5, 1000);
    s.stats.damage = 1;
    for (let t = 0; t < 30; t++) step(s, TICK_DT);
    expect(s.enemies.length).toBe(1); // 還活著
  });

  it('殺意連鎖：擊殺後 killStreak 累加、逾時重置', () => {
    const s = riggedRun(['momentum'], 1, 1);
    s.stats.damage = 1000;
    for (let t = 0; t < 30 && s.kills < 1; t++) step(s, TICK_DT);
    expect(s.kills).toBe(1);
    expect(s.killStreak).toBe(1);
    // 凍結波次推進與後續擊殺，單獨觀察逾時重置
    s.enemies = [];
    s.spawnList = [];
    s.interWaveTimer = 9999;
    s.stats.damage = 0;
    for (let t = 0; t < Math.ceil(2.1 / TICK_DT); t++) step(s, TICK_DT);
    expect(s.killStreak).toBe(0);
  });

  it('背水結界：致命傷害被擋下一次，塔回到 25% 血量', () => {
    const s = newRun({}, 1);
    s.perks = ['lastStand'];
    s.shieldReady = true;
    s.enemies = [];
    s.spawnList = [];
    s.towerHp = 5; // 下一個致命來源會歸零
    // 直接扣血到 0 以下再 step 一次觸發結界判定
    s.towerHp = -10;
    step(s, TICK_DT);
    expect(s.over).toBe(false);
    expect(s.towerHp).toBeCloseTo(s.stats.maxHealth * 0.25, 1);
    expect(s.shieldReady).toBe(false);
  });

  it('精準節拍：每第 4 發必定暴擊', () => {
    const s = riggedRun(['precision'], 1e9, 1e9); // 打不死，觀察開火暴擊節奏
    s.stats.damage = 1;
    let crits = 0;
    let shots = 0;
    for (let t = 0; t < 200 && shots < 8; t++) {
      step(s, TICK_DT);
      for (const e of s.events) {
        if (e.type === 'hit') {
          shots++;
          if (e.crit) crits++;
        }
      }
    }
    // 8 發至少 2 次強制暴擊（第 4、8 發）
    expect(crits).toBeGreaterThanOrEqual(2);
  });
});
