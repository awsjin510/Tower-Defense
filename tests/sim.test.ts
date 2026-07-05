import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT, buyInRunUpgrade, choosePerk } from '../src/core/sim';
import { upgradeCost } from '../src/core/economy';
import { IN_RUN_UPGRADES } from '../src/core/stats';

function runTicks(s: ReturnType<typeof newRun>, seconds: number): void {
  const ticks = Math.floor(seconds / TICK_DT);
  for (let i = 0; i < ticks && !s.over; i++) {
    step(s, TICK_DT);
    // Perk 波會暫停模擬等待選擇；headless 一律拿第一個
    if (s.pendingPerks) choosePerk(s, s.pendingPerks[0]);
  }
}

describe('sim', () => {
  it('相同種子的模擬結果完全一致（確定性）', () => {
    const a = newRun({}, 123);
    const b = newRun({}, 123);
    runTicks(a, 60);
    runTicks(b, 60);
    expect(a.cash).toBe(b.cash);
    expect(a.wave).toBe(b.wave);
    expect(a.kills).toBe(b.kills);
    expect(a.towerHp).toBe(b.towerHp);
  });

  it('會殺敵、賺 Cash 與金幣', () => {
    const s = newRun({}, 7);
    runTicks(s, 45);
    expect(s.kills).toBeGreaterThan(0);
    expect(s.cash).toBeGreaterThan(0);
    expect(s.coinsEarned).toBeGreaterThan(0);
  });

  it('不買任何升級最終會死', () => {
    const s = newRun({}, 7);
    runTicks(s, 3600);
    expect(s.over).toBe(true);
    expect(s.wave).toBeGreaterThanOrEqual(2);
  });

  it('場內升級：扣錢、升級、屬性提升；錢不夠拒買', () => {
    const s = newRun({}, 7);
    const def = IN_RUN_UPGRADES.find((u) => u.id === 'damage')!;
    const baseDamage = s.stats.damage;
    s.cash = upgradeCost(def, 0);
    expect(buyInRunUpgrade(s, 'damage')).toBe(true);
    expect(s.cash).toBe(0);
    expect(s.stats.damage).toBe(baseDamage + def.valuePerLevel);
    expect(buyInRunUpgrade(s, 'damage')).toBe(false);
  });

  it('買血量上限同步補血', () => {
    const s = newRun({}, 7);
    s.towerHp = 50;
    s.cash = 1e9;
    const def = IN_RUN_UPGRADES.find((u) => u.id === 'maxHealth')!;
    buyInRunUpgrade(s, 'maxHealth');
    expect(s.towerHp).toBe(50 + def.valuePerLevel);
  });

  it('工坊等級讓開場屬性更強', () => {
    const weak = newRun({}, 7);
    const strong = newRun({ ws_damage: 10, ws_maxHealth: 10 }, 7);
    expect(strong.stats.damage).toBeGreaterThan(weak.stats.damage);
    expect(strong.towerHp).toBeGreaterThan(weak.towerHp);
  });
});
