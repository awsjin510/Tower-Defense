import { describe, expect, it } from 'vitest';
import { newRun, step, choosePerk, TICK_DT, type SimState } from '../src/core/sim';
import { applyPerks, isPerkWave, perkById, rollPerkChoices, PERKS, PERK_CONFIG } from '../src/core/perks';
import { BASE_STATS } from '../src/core/stats';
import { mulberry32 } from '../src/core/rng';

/** 跑到出現 Perk 三選一或超時 */
function runUntilPerkOffer(s: SimState, maxSec: number): boolean {
  const maxTicks = Math.floor(maxSec / TICK_DT);
  for (let t = 0; t < maxTicks && !s.over; t++) {
    step(s, TICK_DT);
    if (s.pendingPerks) return true;
  }
  return false;
}

describe('perks', () => {
  it('資料表健全：至少 1 個高風險 Perk、id 不重複、屬性乘/加擇一以上', () => {
    expect(PERKS.some((p) => p.risky)).toBe(true);
    expect(new Set(PERKS.map((p) => p.id)).size).toBe(PERKS.length);
    for (const p of PERKS) {
      expect(p.mods.length).toBeGreaterThan(0);
      for (const m of p.mods) expect(Boolean(m.mult) || Boolean(m.add)).toBe(true);
    }
  });

  it('每 offerEvery 波觸發（第 1 波不觸發）', () => {
    expect(isPerkWave(1)).toBe(false);
    expect(isPerkWave(PERK_CONFIG.offerEvery)).toBe(true);
    expect(isPerkWave(PERK_CONFIG.offerEvery * 2)).toBe(true);
    expect(isPerkWave(PERK_CONFIG.offerEvery + 1)).toBe(false);
  });

  it('rollPerkChoices 不重複、排除已取得、池不足時給剩餘全部', () => {
    const rng = mulberry32(7);
    const picks = rollPerkChoices([], rng);
    expect(picks.length).toBe(PERK_CONFIG.choices);
    expect(new Set(picks).size).toBe(picks.length);

    const almostAll = PERKS.slice(0, PERKS.length - 1).map((p) => p.id);
    const rest = rollPerkChoices(almostAll, rng);
    expect(rest).toEqual([PERKS[PERKS.length - 1].id]);
    expect(rollPerkChoices(PERKS.map((p) => p.id), rng)).toEqual([]);
  });

  it('applyPerks 乘法與加法正確、暴擊率夾在 0.8', () => {
    const stats = { ...BASE_STATS };
    applyPerks(stats, ['glassCannon']);
    expect(stats.damage).toBeCloseTo(BASE_STATS.damage * 1.8);
    expect(stats.maxHealth).toBeCloseTo(BASE_STATS.maxHealth * 0.65);

    const s2 = { ...BASE_STATS, critChance: 0.79 };
    applyPerks(s2, ['deadeye']);
    expect(s2.critChance).toBe(0.8);
  });

  it('模擬中到達 Perk 波會暫停，選擇後套用屬性並恢復', () => {
    const s = newRun({}, 42);
    // 給足夠血量讓它活到 Perk 波
    s.stats.maxHealth = 1e9;
    s.towerHp = 1e9;
    expect(runUntilPerkOffer(s, 600)).toBe(true);
    expect(s.wave % PERK_CONFIG.offerEvery).toBe(0);
    const choices = s.pendingPerks!;
    expect(choices.length).toBe(PERK_CONFIG.choices);

    // 暫停：step 不推進時間
    const t0 = s.time;
    step(s, TICK_DT);
    expect(s.time).toBe(t0);

    // 選錯 id 無效
    expect(choosePerk(s, 'not-a-perk')).toBe(false);

    const picked = choices[0];
    const before = { ...s.stats };
    expect(choosePerk(s, picked)).toBe(true);
    expect(s.perks).toEqual([picked]);
    expect(s.pendingPerks).toBeNull();
    // 至少有一個屬性改變了
    const def = perkById(picked)!;
    expect(def.mods.some((m) => s.stats[m.stat] !== before[m.stat])).toBe(true);

    // 恢復推進
    step(s, TICK_DT);
    expect(s.time).toBeGreaterThan(t0);
  });

  it('血量上限型 Perk：提高會補血、降低會夾回上限', () => {
    const s = newRun({}, 1);
    s.pendingPerks = ['fortify'];
    const hpBefore = s.towerHp;
    const maxBefore = s.stats.maxHealth;
    choosePerk(s, 'fortify');
    expect(s.stats.maxHealth).toBeCloseTo(maxBefore * 1.35);
    expect(s.towerHp).toBeCloseTo(hpBefore + maxBefore * 0.35);

    s.pendingPerks = ['glassCannon'];
    choosePerk(s, 'glassCannon');
    expect(s.towerHp).toBeLessThanOrEqual(s.stats.maxHealth);
  });
});
