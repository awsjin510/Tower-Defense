import { describe, expect, it } from 'vitest';
import { formatNumber, upgradeCost, upgradeValue, isMaxed } from '../src/core/economy';
import type { UpgradeDef } from '../src/core/types';

const def: UpgradeDef = {
  id: 'damage',
  name: '傷害',
  category: 'attack',
  stat: 'damage',
  baseCost: 10,
  costGrowth: 1.2,
  valuePerLevel: 4,
  maxLevel: 3,
};

describe('economy', () => {
  it('成本按指數成長', () => {
    expect(upgradeCost(def, 0)).toBe(10);
    expect(upgradeCost(def, 1)).toBe(12);
    expect(upgradeCost(def, 10)).toBe(Math.ceil(10 * 1.2 ** 10));
  });

  it('效果線性累積', () => {
    expect(upgradeValue(def, 0)).toBe(0);
    expect(upgradeValue(def, 5)).toBe(20);
  });

  it('等級上限（0 為無上限）', () => {
    expect(isMaxed(def, 2)).toBe(false);
    expect(isMaxed(def, 3)).toBe(true);
    expect(isMaxed({ ...def, maxLevel: 0 }, 9999)).toBe(false);
  });

  it('大數字格式化', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1500)).toBe('1.50K');
    expect(formatNumber(2_340_000)).toBe('2.34M');
    expect(formatNumber(1e12)).toBe('1.00T');
    expect(formatNumber(1.5e33)).toBe('1.50e33');
  });
});
