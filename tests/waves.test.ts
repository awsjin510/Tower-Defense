import { describe, expect, it } from 'vitest';
import { enemyHp, enemyCountForWave, isBossWave, waveComposition } from '../src/core/waves';
import { mulberry32 } from '../src/core/rng';

describe('waves', () => {
  it('敵人血量隨波次指數遞增', () => {
    expect(enemyHp(10, 1)).toBeGreaterThan(enemyHp(5, 1));
    expect(enemyHp(20, 1) / enemyHp(10, 1)).toBeGreaterThan(1.5);
  });

  it('敵人數量遞增且有上限', () => {
    expect(enemyCountForWave(10)).toBeGreaterThan(enemyCountForWave(1));
    expect(enemyCountForWave(500)).toBeLessThanOrEqual(45);
  });

  it('每 10 波為 Boss 波', () => {
    expect(isBossWave(10)).toBe(true);
    expect(isBossWave(20)).toBe(true);
    expect(isBossWave(7)).toBe(false);
  });

  it('波次組成：低波次只有基礎敵人、Boss 波含頭目', () => {
    const rng = mulberry32(42);
    const w1 = waveComposition(1, rng);
    expect(w1.every((id) => id === 'normal')).toBe(true);
    const w10 = waveComposition(10, rng);
    expect(w10).toContain('boss');
  });
});
