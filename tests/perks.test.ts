import { describe, expect, it } from 'vitest';
import { newRun, step, choosePerk, rerollPerks, skipPerks, currentRerollCost, TICK_DT, type SimState } from '../src/core/sim';
import { applyPerks, isPerkWave, perkById, perkRarity, perkSchool, perkStacks, rerollCost, rollPerkChoices, PERKS, PERK_CONFIG } from '../src/core/perks';
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
      expect(p.mods.length > 0 || Boolean(p.rule)).toBe(true);
      for (const m of p.mods) expect(Boolean(m.mult) || Boolean(m.add)).toBe(true);
    }
  });

  it('每 offerEvery 波觸發（第 1 波不觸發）', () => {
    expect(isPerkWave(1)).toBe(false);
    expect(isPerkWave(PERK_CONFIG.offerEvery)).toBe(true);
    expect(isPerkWave(PERK_CONFIG.offerEvery * 2)).toBe(true);
    expect(isPerkWave(PERK_CONFIG.offerEvery + 1)).toBe(false);
  });

  it('rollPerkChoices 同一次不重複、非疊加已取得會排除', () => {
    const rng = mulberry32(7);
    const picks = rollPerkChoices([], rng);
    expect(picks.length).toBe(PERK_CONFIG.choices);
    expect(new Set(picks).size).toBe(picks.length);

    // 非疊加 Perk 取得後不再出現；把所有非疊加的都拿走，只剩疊加型可抽
    const nonStack = PERKS.filter((p) => !p.stackable).map((p) => p.id);
    const rest = rollPerkChoices(nonStack, mulberry32(3), 99);
    expect(rest.every((id) => perkById(id)!.stackable)).toBe(true);
    for (const id of nonStack) expect(rest).not.toContain(id);
  });

  it('可疊加 Perk 未達上限仍在池中、達上限後排除', () => {
    const sharp = perkById('sharp')!;
    const max = sharp.maxStacks!;
    // 已疊到上限：不再出現
    const taken = Array(max).fill('sharp');
    const rolled = rollPerkChoices(taken, mulberry32(5), 99);
    expect(rolled).not.toContain('sharp');
    // 未達上限：仍可能出現
    const partial = rollPerkChoices(['sharp'], mulberry32(5), 99);
    expect(partial).toContain('sharp');
  });

  it('稀有度加權：深波抽到高稀有度的比例明顯上升', () => {
    const countLegend = (wave: number) => {
      let n = 0;
      for (let seed = 0; seed < 400; seed++) {
        const picks = rollPerkChoices([], mulberry32(seed), 1, wave);
        if (picks[0] && perkById(picks[0])!.rarity !== 'common') n++;
      }
      return n;
    };
    expect(countLegend(50)).toBeGreaterThan(countLegend(5));
  });

  it('重骰花費隨次數指數上升、跳過給現金並結束選擇', () => {
    expect(rerollCost(1)).toBeGreaterThan(rerollCost(0));
    const s = newRun({}, 9);
    s.pendingPerks = ['sharp', 'rapid', 'fortify'];
    s.cash = 100000;
    const cost0 = currentRerollCost(s);
    expect(rerollPerks(s)).toBe(true);
    expect(s.pendingPerks!.length).toBe(PERK_CONFIG.choices);
    expect(currentRerollCost(s)).toBeGreaterThan(cost0);
    // 跳過：領到現金、pendingPerks 清空
    const cashBefore = s.cash;
    const reward = skipPerks(s);
    expect(reward).toBeGreaterThan(0);
    expect(s.cash).toBe(cashBefore + reward);
    expect(s.pendingPerks).toBeNull();
  });

  it('perkStacks 正確計算層數；choosePerk 允許疊加', () => {
    const s = newRun({}, 2);
    s.pendingPerks = ['sharp'];
    choosePerk(s, 'sharp');
    s.pendingPerks = ['sharp'];
    choosePerk(s, 'sharp');
    expect(perkStacks(s.perks, 'sharp')).toBe(2);
    // 疊加後傷害倍率為 1.3^2
    expect(s.stats.damage).toBeCloseTo(newRun({}, 2).stats.damage * 1.3 * 1.3);
  });

  it('流派進階 Perk 只在取得前置核心後進入選池', () => {
    const withoutCore = rollPerkChoices(PERKS.filter((p) => !p.prerequisite).map((p) => p.id).filter((id) => id !== 'incendiary'), mulberry32(1), 99);
    expect(withoutCore).not.toContain('wildfire');
    const withCore = rollPerkChoices(PERKS.filter((p) => !p.prerequisite).map((p) => p.id), mulberry32(1), 99);
    expect(withCore).toContain('wildfire');
    expect(withCore).toContain('volatileFuel');
  });

  it('視覺分類能辨識燃燒、冰凍、風險與進階稀有度', () => {
    expect(perkSchool(perkById('incendiary')!)).toBe('fire');
    expect(perkSchool(perkById('cryoRounds')!)).toBe('frost');
    expect(perkSchool(perkById('glassCannon')!)).toBe('risk');
    expect(perkRarity(perkById('wildfire')!)).toBe('史詩');
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
    expect(Boolean(def.rule) || def.mods.some((m) => s.stats[m.stat] !== before[m.stat])).toBe(true);

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
