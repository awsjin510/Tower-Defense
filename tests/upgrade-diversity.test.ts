import { describe, expect, it } from 'vitest';
import { IN_RUN_UPGRADES, computeStats } from '../src/core/stats';
import { inRunUpgradeCost, newRun } from '../src/core/sim';
import { upgradeCost } from '../src/core/economy';

describe('upgrade diversity', () => {
  it('攻擊、防禦、經濟各自至少有兩種機制型升級', () => {
    const ids = new Set(IN_RUN_UPGRADES.map((u) => u.id));
    expect(['knockback', 'splashChance'].every((id) => ids.has(id))).toBe(true);
    expect(['thorns', 'killHeal'].every((id) => ids.has(id))).toBe(true);
    expect(['upgradeDiscount', 'eliteBounty'].every((id) => ids.has(id))).toBe(true);
  });

  it('升級折扣會降低實際場內價格且受 35% 上限保護', () => {
    const def = IN_RUN_UPGRADES.find((u) => u.id === 'damage')!;
    const s = newRun({}, 1);
    s.stats = computeStats({}, { upgradeDiscount: 20 });
    expect(s.stats.upgradeDiscount).toBeLessThanOrEqual(0.35);
    expect(inRunUpgradeCost(s, def, 8)).toBeLessThan(upgradeCost(def, 8));
  });
});
