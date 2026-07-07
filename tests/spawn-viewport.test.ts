import { describe, expect, it } from 'vitest';
import { newRun, setSpawnViewport, step, TICK_DT, WORLD_SIZE } from '../src/core/sim';

describe('screen-edge spawning', () => {
  it('橫向畫面會從矩形螢幕邊界出生，不受雷達圓限制', () => {
    const s = newRun({}, 7);
    setSpawnViewport(s, 900, 600);
    expect(s.spawnHalfWidth).toBeCloseTo((900 / 600) * WORLD_SIZE / 2);
    expect(s.spawnHalfWidth).toBeGreaterThan(s.spawnHalfHeight);

    for (let i = 0; i < 20 && s.enemies.length === 0; i++) step(s, TICK_DT);
    expect(s.enemies).toHaveLength(1);
    const enemy = s.enemies[0];
    const inset = enemy.radius * 0.5;
    // 出生的同一 tick 會立刻朝塔移動一小段，因此保留 3 世界單位容差。
    const onVerticalEdge = Math.abs(Math.abs(enemy.x) - (s.spawnHalfWidth - inset)) < 3;
    const onHorizontalEdge = Math.abs(Math.abs(enemy.y) - (s.spawnHalfHeight - inset)) < 3;
    expect(onVerticalEdge || onHorizontalEdge).toBe(true);
  });
});
